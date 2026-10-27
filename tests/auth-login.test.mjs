import assert from 'node:assert/strict'
import test from 'node:test'
import { createLoginService } from '../src/auth/login.ts'

const credentials = { email: 'person@example.invalid', password: 'unit-password' }
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers })
const service = (fetcher, options = {}) => createLoginService({ baseUrl: 'https://example.invalid', fetcher, ...options })

test('login sends only email/password without bearer/cookies and extracts only the confirmed token field', async () => {
  let request
  const login = service(async (url, init) => {
    request = { url, init }
    return json({ token: 'synthetic-value', extra: 'not-returned' })
  })
  const result = await login({ ...credentials, email: ' person@example.invalid ', password: ' unit-password ', extra: 'not-sent' })
  assert.equal(result, 'synthetic-value')
  assert.equal(request.url, 'https://example.invalid/api/auth/login')
  assert.equal(request.init.method, 'POST')
  assert.equal(new Headers(request.init.headers).has('Authorization'), false)
  assert.equal(request.init.credentials, 'omit')
  assert.equal(request.init.cache, 'no-store')
  assert.deepEqual(JSON.parse(request.init.body), { email: credentials.email, password: ' unit-password ' })
})

test('invalid credentials are rejected before sending; malformed success payloads are safe failures', async () => {
  let calls = 0
  const login = service(async () => { calls++; return json({}) })
  for (const input of [{}, { ...credentials, email: ' ' }, { ...credentials, password: '' }]) {
    await assert.rejects(login(input), error => error.kind === 'invalid-request')
  }
  assert.equal(calls, 0)
  for (const payload of [{}, { accessToken: 'private-placeholder' }, { token: null }]) {
    await assert.rejects(service(async () => json(payload))(credentials), error => error.kind === 'invalid-response')
  }
  await assert.rejects(service(async () => new Response('private-non-json'))(credentials), error => {
    assert.equal(error.kind, 'invalid-response')
    assert.doesNotMatch(error.message, /private-non-json/)
    return true
  })
})

test('login reports 401 and network errors without retaining response or transport details', async () => {
  await assert.rejects(service(async () => json({ debug: 'private-debug' }, 401))(credentials), error => {
    assert.equal(error.status, 401)
    assert.equal(error.kind, 'authentication')
    assert.doesNotMatch(`${error}${JSON.stringify(error)}`, /private-debug|unit-password/)
    return true
  })
  await assert.rejects(service(async () => { throw new Error('private-transport') })(credentials), error => {
    assert.equal(error.kind, 'network')
    assert.equal(error.cause, undefined)
    assert.doesNotMatch(error.message, /private-transport/)
    return true
  })
})

test('login honors server Retry-After without retries and never fabricates a renewal call', async () => {
  let now = Date.UTC(2026, 9, 27)
  let calls = 0
  const login = service(async url => {
    assert.ok(url.endsWith('/api/auth/login'))
    calls++
    return calls === 1 ? json({}, 429, { 'Retry-After': '30' }) : json({ token: 'synthetic-value' })
  }, { now: () => now })
  await assert.rejects(login(credentials), error => error.retryAt === now + 30_000)
  await assert.rejects(login(credentials), error => error.kind === 'rate-limit')
  assert.equal(calls, 1)
  now += 30_000
  assert.equal(await login(credentials), 'synthetic-value')
  assert.equal(calls, 2)
})

test('a cancelled login response never returns its token to the session manager', async () => {
  const controller = new AbortController()
  let finish
  const login = service(() => new Promise(resolve => { finish = resolve }))
  const pending = login(credentials, controller.signal)
  const cancelled = assert.rejects(pending, error => error.name === 'AbortError')
  controller.abort()
  finish(json({ token: 'synthetic-value' }))
  await cancelled
})
