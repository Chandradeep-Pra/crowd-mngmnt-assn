import assert from 'node:assert/strict'
import test from 'node:test'
import { setImmediate as tick } from 'node:timers/promises'
import { createSessionRuntime, SESSION_STORAGE_KEY } from '../src/auth/session.ts'
import { jwtExpiry } from '../src/auth/jwt.ts'

const credentials = { email: 'person@example.invalid', password: 'unit-password' }
const range = { siteId: '<site-a>', fromUtc: 0, toUtc: 3_600_000 }
const json = (data, status = 200) => new Response(JSON.stringify(data), { status })
// Generated in memory: these are synthetic JWT-shaped strings, not usable credentials.
function syntheticToken(exp, tag = 'test') {
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url')
  return [encode({ alg: 'HS256', typ: 'JWT' }), encode(exp === undefined ? { tag } : { exp, tag }), 'synthetic-signature'].join('.')
}
function fakeStorage(initial = []) {
  const values = new Map(initial)
  return {
    getItem: key => values.get(key) ?? null,
    setItem: (key, value) => { values.set(key, value) },
    removeItem: key => { values.delete(key) },
    values,
  }
}
function fakeClock() {
  let now = Date.UTC(2026, 9, 27)
  let next = 0
  const tasks = new Map()
  return {
    now: () => now,
    schedule(callback, delay) {
      const id = ++next
      tasks.set(id, { callback, deadline: now + delay, delay })
      return () => { tasks.delete(id) }
    },
    advance(ms, run = true) {
      const target = now + ms
      if (run) {
        for (;;) {
          const task = [...tasks].sort((a, b) => a[1].deadline - b[1].deadline)[0]
          if (!task || task[1].deadline > target) break
          tasks.delete(task[0])
          now = task[1].deadline
          task[1].callback()
        }
      }
      now = target
    },
    tasks,
  }
}
let scopeCounter = 0
function setup(t, options = {}) {
  const storage = options.storage ?? fakeStorage()
  const clock = options.clock ?? fakeClock()
  const calls = []
  const fetcher = options.fetcher ?? (async (url, init) => {
    calls.push({ url, init })
    if (url.endsWith('/api/auth/login')) return json({ token: syntheticToken(clock.now() / 1000 + 60) })
    if (url.endsWith('/api/sites')) return json([])
    return json({ ...range, footfall: 0 })
  })
  const runtime = createSessionRuntime({
    baseUrl: 'https://example.invalid', getStorage: options.getStorage ?? (() => storage),
    now: clock.now, schedule: clock.schedule, fetcher,
    createScope: () => `scope-${++scopeCounter}`,
  })
  t.after(() => runtime.stop())
  return { runtime, storage, clock, calls }
}

test('construction is side-effect-free and start/stop/start tolerates StrictMode effect replay', t => {
  let storageReads = 0
  const storage = fakeStorage()
  const { runtime, calls } = setup(t, { getStorage: () => { storageReads++; return storage } })
  assert.equal(storageReads, 0)
  assert.equal(runtime.getSnapshot().status, 'restoring')
  assert.equal(runtime.getSnapshot(), runtime.getSnapshot())
  runtime.start()
  runtime.start()
  runtime.stop()
  runtime.start()
  assert.equal(storageReads, 1)
  assert.equal(calls.length, 0)
  assert.equal(runtime.getSnapshot().status, 'signed-out')
})

test('successful login saves only the token; public state and query/mutation caches contain no credentials', async t => {
  const { runtime, storage, calls } = setup(t)
  runtime.start()
  const statuses = []
  const unsubscribe = runtime.subscribe(() => statuses.push(runtime.getSnapshot().status))
  await runtime.signIn(credentials)
  unsubscribe()
  const saved = JSON.parse(storage.getItem(SESSION_STORAGE_KEY))
  assert.deepEqual(Object.keys(saved), ['token'])
  assert.deepEqual(statuses, ['signing-in', 'signed-in'])
  const state = runtime.getSnapshot()
  assert.equal(state.status, 'signed-in')
  assert.equal(Object.isFrozen(state), true)
  assert.ok(!JSON.stringify(state).includes(saved.token))
  assert.ok(!JSON.stringify(state).includes(credentials.password))
  assert.equal(runtime.queryClient.getQueryCache().getAll().length, 0)
  assert.equal(runtime.queryClient.getMutationCache().getAll().length, 0)
  assert.equal(calls.length, 1)
})

test('a reload restores an unexpired session without login and uses a fresh cache scope', async t => {
  const first = setup(t)
  first.runtime.start()
  await first.runtime.signIn(credentials)
  const previousScope = first.runtime.getSnapshot().scope
  first.runtime.stop()
  assert.ok(first.storage.getItem(SESSION_STORAGE_KEY))
  const second = setup(t, { storage: first.storage, clock: first.clock })
  second.runtime.start()
  assert.equal(second.runtime.getSnapshot().status, 'signed-in')
  assert.notEqual(second.runtime.getSnapshot().scope, previousScope)
  assert.equal(second.calls.length, 0)
  assert.ok(second.runtime.getQueries())
  const scope = second.runtime.getSnapshot().scope
  second.runtime.stop()
  second.runtime.start()
  assert.equal(second.runtime.getSnapshot().scope, scope)
  assert.equal(second.clock.tasks.size, 1)
})

test('expired and malformed saved sessions are removed without network requests', t => {
  const clock = fakeClock()
  const invalid = ['not-json', JSON.stringify({ token: 'not-a-jwt' }), JSON.stringify({ token: '' }), JSON.stringify({ token: syntheticToken(clock.now() / 1000 - 1) })]
  for (const value of invalid) {
    const storage = fakeStorage([[SESSION_STORAGE_KEY, value]])
    const { runtime, calls } = setup(t, { storage, clock })
    runtime.start()
    assert.equal(runtime.getSnapshot().status, 'signed-out')
    assert.equal(storage.getItem(SESSION_STORAGE_KEY), null)
    assert.equal(calls.length, 0)
    assert.equal(runtime.getQueries(), null)
  }
})

test('JWT expiry parsing uses seconds and tolerates absent exp without trusting a role or signature', () => {
  assert.equal(jwtExpiry(syntheticToken(1.5)), 1500)
  assert.equal(jwtExpiry(syntheticToken(undefined)), null)
  for (const token of ['not-a-jwt', syntheticToken('future'), syntheticToken({ value: 10 })]) {
    assert.throws(() => jwtExpiry(token), error => error.kind === 'invalid-response')
  }
})

test('logout clears only this saved session and its cached data, preserving unrelated storage/cache entries', async t => {
  const { runtime, storage } = setup(t)
  storage.setItem('unrelated', 'keep')
  runtime.start()
  await runtime.signIn(credentials)
  const options = runtime.getQueries().footfall(range)
  await runtime.queryClient.fetchQuery(options)
  runtime.queryClient.setQueryData(['public-example'], 1)
  await runtime.signOut()
  assert.equal(runtime.getSnapshot().reason, 'logout')
  assert.equal(runtime.getQueries(), null)
  assert.equal(storage.getItem(SESSION_STORAGE_KEY), null)
  assert.equal(storage.getItem('unrelated'), 'keep')
  assert.equal(runtime.queryClient.getQueryData(options.queryKey), undefined)
  assert.equal(runtime.queryClient.getQueryData(['public-example']), 1)
})

test('expiry cancels a session and removes saved/cached data without a login or refresh request', async t => {
  const { runtime, clock, storage, calls } = setup(t)
  runtime.start()
  await runtime.signIn(credentials)
  const options = runtime.getQueries().footfall(range)
  await runtime.queryClient.fetchQuery(options)
  clock.advance(60_000)
  await tick()
  assert.equal(runtime.getSnapshot().reason, 'expired')
  assert.equal(storage.getItem(SESSION_STORAGE_KEY), null)
  assert.equal(runtime.queryClient.getQueryData(options.queryKey), undefined)
  assert.equal(calls.length, 2)
  assert.equal(calls.filter(call => call.url.endsWith('/api/auth/login')).length, 1)
})

test('focus/visibility rechecks catch expiration after background timer throttling', async t => {
  const { runtime, clock } = setup(t)
  runtime.start()
  await runtime.signIn(credentials)
  clock.advance(120_000, false)
  runtime.checkExpiry()
  await tick()
  assert.equal(runtime.getSnapshot().reason, 'expired')
})

test('long expiry timers are chunked rather than overflowing into immediate logout', async t => {
  const clock = fakeClock()
  const token = syntheticToken((clock.now() + 2_147_483_647 + 1000) / 1000)
  const { runtime } = setup(t, { clock, storage: fakeStorage([[SESSION_STORAGE_KEY, JSON.stringify({ token })]]) })
  runtime.start()
  assert.equal([...clock.tasks.values()][0].delay, 2_147_483_647)
  clock.advance(2_147_483_647)
  assert.equal(runtime.getSnapshot().status, 'signed-in')
  clock.advance(1000)
  await tick()
  assert.equal(runtime.getSnapshot().reason, 'expired')
})

test('logout during pending sign-in prevents late success from resurrecting the session', async t => {
  const clock = fakeClock()
  let finish
  let signal
  const { runtime, storage } = setup(t, { clock, fetcher: (_, init) => {
    signal = init.signal
    return new Promise(resolve => { finish = resolve })
  } })
  runtime.start()
  const pending = runtime.signIn(credentials)
  const cancelled = assert.rejects(pending, error => error.name === 'AbortError')
  await runtime.signOut()
  assert.equal(signal.aborted, true)
  finish(json({ token: syntheticToken(clock.now() / 1000 + 60) }))
  await cancelled
  assert.equal(runtime.getSnapshot().reason, 'logout')
  assert.equal(storage.getItem(SESSION_STORAGE_KEY), null)
})

test('overlapping login attempts only commit the latest result', async t => {
  const clock = fakeClock()
  const finish = []
  const { runtime, storage } = setup(t, { clock, fetcher: () => new Promise(resolve => { finish.push(resolve) }) })
  runtime.start()
  const first = runtime.signIn(credentials)
  const cancelled = assert.rejects(first, error => error.name === 'AbortError')
  const second = runtime.signIn(credentials)
  const secondToken = syntheticToken(clock.now() / 1000 + 60, 'second')
  finish[1](json({ token: secondToken }))
  await second
  const scope = runtime.getSnapshot().scope
  finish[0](json({ token: syntheticToken(clock.now() / 1000 + 60, 'first') }))
  await cancelled
  assert.equal(runtime.getSnapshot().scope, scope)
  assert.equal(JSON.parse(storage.getItem(SESSION_STORAGE_KEY)).token, secondToken)
})

test('current-session 401 clears the session; old-scope 401 cannot clear a newer session even with the same token', async t => {
  const clock = fakeClock()
  const token = syntheticToken(clock.now() / 1000 + 60)
  let finishRead
  const { runtime, storage } = setup(t, { clock, fetcher: async url => {
    if (url.endsWith('/api/auth/login')) return json({ token })
    return new Promise(resolve => { finishRead = resolve })
  } })
  runtime.start()
  await runtime.signIn(credentials)
  const oldOptions = runtime.getQueries().sites()
  const oldRead = oldOptions.queryFn({ signal: undefined })
  const oldRejected = assert.rejects(oldRead, error => error.kind === 'authentication')
  await runtime.signIn(credentials)
  const newScope = runtime.getSnapshot().scope
  finishRead(json({}, 401))
  await oldRejected
  assert.equal(runtime.getSnapshot().scope, newScope)
  assert.ok(storage.getItem(SESSION_STORAGE_KEY))

  const currentRead = runtime.getQueries().sites().queryFn({ signal: undefined })
  const rejected = assert.rejects(currentRead, error => error.kind === 'authentication')
  finishRead(json({}, 401))
  await rejected
  await tick()
  assert.equal(runtime.getSnapshot().reason, 'unauthorized')
  assert.equal(storage.getItem(SESSION_STORAGE_KEY), null)
})

test('blocked storage and failed writes do not silently fall back to an ephemeral login', async t => {
  const blocked = setup(t, { getStorage: () => { throw new Error('private-storage-details') } })
  blocked.runtime.start()
  assert.equal(blocked.runtime.getSnapshot().reason, 'storage-unavailable')
  await assert.rejects(blocked.runtime.signIn(credentials), error => error.kind === 'configuration')
  assert.equal(blocked.calls.length, 0)

  const storage = fakeStorage()
  storage.setItem = () => { throw new Error('private-quota-details') }
  const write = setup(t, { storage })
  write.runtime.start()
  await assert.rejects(write.runtime.signIn(credentials), error => error.kind === 'configuration')
  assert.equal(write.runtime.getSnapshot().reason, 'storage-unavailable')
  assert.equal(write.runtime.getQueries(), null)
  assert.equal(storage.getItem(SESSION_STORAGE_KEY), null)
  assert.doesNotMatch(write.runtime.getSnapshot().message, /private-quota-details/)
})

test('failed account switching clears the previous cache even if storage removal fails', async t => {
  const { runtime, storage } = setup(t)
  runtime.start()
  await runtime.signIn(credentials)
  const options = runtime.getQueries().footfall(range)
  await runtime.queryClient.fetchQuery(options)
  storage.removeItem = () => { throw new Error('blocked') }
  await assert.rejects(runtime.signIn(credentials), error => error.kind === 'configuration')
  assert.equal(runtime.queryClient.getQueryData(options.queryKey), undefined)
  assert.equal(runtime.getQueries(), null)
  assert.equal(runtime.getSnapshot().reason, 'storage-unavailable')
})

test('a failed login returns signed-out state and never stores credentials or a response', async t => {
  const { runtime, storage } = setup(t, { fetcher: async () => json({ debug: 'private-server-data' }, 401) })
  runtime.start()
  await assert.rejects(runtime.signIn(credentials), error => error.status === 401)
  assert.equal(runtime.getSnapshot().reason, 'login-failed')
  assert.equal(storage.values.size, 0)
  assert.doesNotMatch(JSON.stringify(runtime.getSnapshot()), /unit-password|private-server-data/)
})

test('session logout closes live feeds and callbacks from the old account cannot terminate a newer login', async t => {
  const { runtime } = setup(t)
  runtime.start(); await runtime.signIn(credentials)
  const handlers = new Map()
  let closed = 0
  const socket = { auth: {}, on: (name, callback) => handlers.set(name, callback), removeAllListeners: () => handlers.clear(), connect() {}, disconnect: () => closed++ }
  const feed = runtime.createFeed('site-a', (_origin, options) => { socket.auth = options.auth; return socket })
  feed.start()
  const lateError = handlers.get('connect_error')
  await runtime.signOut()
  assert.equal(closed, 1)
  assert.deepEqual(socket.auth, {})
  assert.equal(handlers.size, 0)
  await runtime.signIn(credentials)
  lateError(new Error('Authentication error'))
  assert.equal(runtime.getSnapshot().status, 'signed-in')
})

test('session expiry closes a connected live feed and clears its retained movement data', async t => {
  const { runtime, clock } = setup(t)
  runtime.start(); await runtime.signIn(credentials)
  const handlers = new Map()
  let closed = 0
  const socket = { auth: {}, on: (name, callback) => handlers.set(name, callback), removeAllListeners: () => handlers.clear(), connect() {}, disconnect: () => closed++ }
  const feed = runtime.createFeed('site-a', () => socket)
  feed.start(); handlers.get('connect')()
  clock.advance(60_000)
  assert.equal(runtime.getSnapshot().status, 'signed-out')
  assert.equal(closed, 1)
  assert.equal(feed.getSnapshot().live, null)
  assert.deepEqual(feed.getSnapshot().alerts, [])
})
