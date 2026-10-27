import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiError, createApiClient } from '../src/api/client.ts'

const range = { siteId: '<site-a>', fromUtc: 0, toUtc: 3_600_000 }
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json', ...headers },
})
const makeClient = (fetcher, options = {}) => createApiClient({
  baseUrl: 'https://example.invalid/', getAccessToken: () => 'unit-session', fetcher, ...options,
})
const kind = (expected) => (error) => error instanceof ApiError && error.kind === expected

test('echoed site and period mismatches cannot populate another site or window', async () => {
  for (const wrong of [{ siteId: 'other-site' }, { fromUtc: 1 }, { toUtc: 99 }]) {
    const api = makeClient(async () => json({ ...range, ...wrong, footfall: 5 }))
    await assert.rejects(api.footfall(range), kind('invalid-response'))
  }
})

test('construction makes no call and only exposes modeled read operations', () => {
  let calls = 0
  const api = makeClient(async () => { calls++; return json([]) })
  assert.equal(calls, 0)
  assert.deepEqual(Object.keys(api).sort(), ['demographics', 'dwell', 'entryExit', 'footfall', 'occupancy', 'site', 'sites'])
  for (const baseUrl of ['//other.invalid', 'file:///data', 'https://user:secret@example.invalid', 'https://example.invalid/?token=secret']) {
    assert.throws(() => makeClient(async () => json([]), { baseUrl }), kind('configuration'))
  }
})

test('authenticated reads use recorded paths/methods, encoded IDs and only canonical request fields', async () => {
  const calls = []
  const api = makeClient(async (url, init) => {
    calls.push({ url, init })
    return json(url.endsWith('/sites') ? [] : {})
  })
  await api.sites()
  await api.site('site one/child')
  for (const metric of ['footfall', 'dwell', 'occupancy', 'demographics']) {
    await api[metric]({ ...range, unrelated: 'must-not-send' })
  }
  await api.entryExit(range)
  assert.equal(calls[0].url, 'https://example.invalid/api/sites')
  assert.equal(calls[1].url, 'https://example.invalid/api/sites/site%20one%2Fchild')
  for (const { init } of calls) {
    assert.equal(init.headers.get('Authorization'), 'Bearer unit-session')
    assert.equal(init.credentials, 'omit')
    assert.equal(init.redirect, 'error')
    assert.equal(init.cache, 'no-store')
  }
  for (const { url, init } of calls.slice(2, 6)) {
    assert.match(url, /\/api\/analytics\/(footfall|dwell|occupancy|demographics)$/)
    assert.equal(init.method, 'POST')
    assert.equal(init.headers.get('Content-Type'), 'application/json')
    assert.deepEqual(JSON.parse(init.body), range)
  }
  assert.deepEqual(JSON.parse(calls[6].init.body), { ...range, pageSize: 50, pageNumber: 1 })
})

test('empty credentials, unbounded/reversed ranges and invalid pages never reach the network', async () => {
  let calls = 0
  const fetcher = async () => { calls++; return json({}) }
  const api = makeClient(fetcher)
  for (const input of [{}, { ...range, siteId: '' }, { ...range, fromUtc: range.toUtc }, { ...range, toUtc: NaN }]) {
    await assert.rejects(api.footfall(input), kind('invalid-request'))
  }
  for (const pageSize of [0, -1, 1.5]) {
    await assert.rejects(api.entryExit({ ...range, pageSize }), kind('invalid-request'))
  }
  await assert.rejects(api.site('..'), kind('invalid-request'))
  await assert.rejects(makeClient(fetcher, { getAccessToken: () => null }).sites(), kind('authentication'))
  assert.equal(calls, 0)
})

test('same-origin path prefixes are configurable without hard-coded staging hosts', async () => {
  const urls = []
  const fetcher = async (url) => { urls.push(url); return json([]) }
  await makeClient(fetcher, { baseUrl: '' }).sites()
  await makeClient(fetcher, { baseUrl: '/backend/' }).sites()
  assert.deepEqual(urls, ['/api/sites', '/backend/api/sites'])
})

test('response shape validation and malformed JSON produce safe errors', async () => {
  const cases = [json({ footfall: 'not-a-number' }), new Response('not-json'), json(null)]
  for (const response of cases) {
    const api = makeClient(async () => response)
    await assert.rejects(api.footfall(range), (error) => {
      assert.equal(error.kind, 'invalid-response')
      assert.equal(error.status, 200)
      assert.doesNotMatch(error.message, /not-a-number|not-json/)
      return true
    })
  }
})

test('HTTP and network errors never retain raw server bodies or transport error details', async () => {
  for (const status of [403, 500]) {
    await assert.rejects(makeClient(async () => json({ internal: 'private-debug' }, status)).sites(), (error) => {
      assert.equal(error.status, status)
      assert.equal(error.kind, status === 403 ? 'authorization' : 'http')
      assert.doesNotMatch(`${error}${JSON.stringify(error)}`, /private-debug/)
      assert.equal(error.cause, undefined)
      return true
    })
  }
  await assert.rejects(makeClient(async () => { throw new Error('private-transport-details') }).sites(), (error) => {
    assert.equal(error.kind, 'network')
    assert.doesNotMatch(`${error}${JSON.stringify(error)}`, /private-transport-details/)
    assert.equal(error.cause, undefined)
    return true
  })
})

test('401 notifies the current session; a stale 401 does not sign out a newer token', async () => {
  let notified = 0
  const options = { onUnauthorized: () => { notified++ } }
  await assert.rejects(makeClient(async () => json({}, 401), options).sites(), kind('authentication'))
  assert.equal(notified, 1)

  let token = 'old-unit-session'
  let finish
  const api = makeClient(() => new Promise(resolve => { finish = resolve }), {
    ...options, getAccessToken: () => token,
  })
  const pending = api.sites()
  token = 'new-unit-session'
  finish(json({}, 401))
  await assert.rejects(pending, kind('authentication'))
  assert.equal(notified, 1)
})

test('the token callback is read for every request and no token is returned as error metadata', async () => {
  let token = 'first-unit-session'
  const seen = []
  const api = makeClient(async (_, init) => {
    seen.push(init.headers.get('Authorization'))
    return json([])
  }, { getAccessToken: () => token })
  await api.sites()
  token = 'second-unit-session'
  await api.sites()
  assert.deepEqual(seen, ['Bearer first-unit-session', 'Bearer second-unit-session'])
})

test('429 Retry-After seconds gates further calls across this client until the deadline', async () => {
  let now = Date.UTC(2026, 9, 27)
  let calls = 0
  const api = makeClient(async () => {
    calls++
    return calls === 1 ? json({}, 429, { 'Retry-After': '10' }) : json([])
  }, { now: () => now })
  const retryAt = now + 10_000
  await assert.rejects(api.footfall(range), error => error.status === 429 && error.retryAt === retryAt)
  await assert.rejects(api.sites(), error => error.retryAt === retryAt)
  assert.equal(calls, 1)
  now = retryAt
  assert.deepEqual(await api.sites(), [])
  assert.equal(calls, 2)
})

test('429 accepts an HTTP-date; missing or invalid Retry-After does not invent a cooldown', async () => {
  const now = Date.UTC(2026, 9, 27)
  const date = new Date(now + 30_000).toUTCString()
  const dated = makeClient(async () => json({}, 429, { 'Retry-After': date }), { now: () => now })
  await assert.rejects(dated.sites(), error => error.retryAt === now + 30_000)
  for (const value of [null, '-1', '1.5', 'not-a-date', '9'.repeat(400)]) {
    let calls = 0
    const api = makeClient(async () => {
      calls++
      return calls === 1 ? json({}, 429, value === null ? {} : { 'Retry-After': value }) : json([])
    }, { now: () => now })
    await assert.rejects(api.sites(), error => error.status === 429 && error.retryAt === null)
    assert.deepEqual(await api.sites(), [])
    assert.equal(calls, 2)
  }
})

test('concurrent 429 responses cannot shorten an existing server retry deadline', async () => {
  let now = Date.UTC(2026, 9, 27)
  const finish = []
  let calls = 0
  const api = makeClient(() => {
    calls++
    return calls <= 2 ? new Promise(resolve => { finish.push(resolve) }) : Promise.resolve(json([]))
  }, { now: () => now })
  const first = api.sites()
  const second = api.footfall(range)
  const retryAt = now + 60_000
  finish[0](json({}, 429, { 'Retry-After': '60' }))
  await assert.rejects(first, error => error.retryAt === retryAt)
  finish[1](json({}, 429, { 'Retry-After': '10' }))
  await assert.rejects(second, error => error.retryAt === retryAt)
  now += 10_000
  await assert.rejects(api.sites(), kind('rate-limit'))
  assert.equal(calls, 2)
  now = retryAt
  assert.deepEqual(await api.sites(), [])
})

test('a previous account cooldown does not apply after the token changes', async () => {
  let token = 'old-unit-session'
  let calls = 0
  const api = makeClient(async () => {
    calls++
    return calls === 1 ? json({}, 429, { 'Retry-After': '60' }) : json([])
  }, { getAccessToken: () => token })
  await assert.rejects(api.sites(), kind('rate-limit'))
  token = 'new-unit-session'
  assert.deepEqual(await api.sites(), [])
  assert.equal(calls, 2)
})

test('already-aborted and in-flight requests keep cancellation separate from network failures', async () => {
  const before = new AbortController()
  before.abort()
  let calls = 0
  const api = makeClient(async (_, { signal }) => {
    calls++
    return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new DOMException('cancelled', 'AbortError')), { once: true }))
  })
  await assert.rejects(api.sites(before.signal), error => error.name === 'AbortError')
  assert.equal(calls, 0)
  const active = new AbortController()
  const pending = api.sites(active.signal)
  active.abort()
  await assert.rejects(pending, error => error.name === 'AbortError')
  assert.equal(calls, 1)
})
