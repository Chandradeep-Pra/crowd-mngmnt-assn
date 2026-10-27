import assert from 'node:assert/strict'
import test from 'node:test'
import { isCancelledError } from '@tanstack/react-query'
import { createApiClient } from '../src/api/client.ts'
import { createApiQueryClient } from '../src/api/query-client.ts'
import { clearSessionQueries, createApiQueries } from '../src/api/queries.ts'

const range = { siteId: '<site-a>', fromUtc: 0, toUtc: 3_600_000 }
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers })
const apiFor = fetcher => createApiClient({
  baseUrl: 'https://example.invalid', getAccessToken: () => 'unit-session', fetcher,
})
function setup(t, fetcher) {
  const client = createApiQueryClient()
  t.after(() => client.clear())
  const api = apiFor(fetcher)
  return { client, api, queries: createApiQueries(api, 'scope-a') }
}

test('identical in-flight reads share one fetch and fresh results are reused', async t => {
  let calls = 0
  let finish
  const { client, queries } = setup(t, () => {
    calls++
    return new Promise(resolve => { finish = resolve })
  })
  const options = queries.footfall(range)
  const first = client.fetchQuery(options)
  const second = client.fetchQuery(options)
  assert.equal(calls, 1)
  finish(json({ ...range, footfall: 0 }))
  const results = await Promise.all([first, second])
  assert.deepEqual(results[0], results[1])
  assert.equal(results[0].footfall, 0)
  await client.fetchQuery(options)
  assert.equal(calls, 1)
  await client.invalidateQueries({ queryKey: options.queryKey, refetchType: 'none' })
  const refreshed = client.fetchQuery(options)
  assert.equal(calls, 2)
  finish(json({ ...range, footfall: 1 }))
  assert.equal((await refreshed).footfall, 1)
})

test('site, range, metric, page and session each isolate their cached results without token keys', async t => {
  let calls = 0
  const { client, api, queries } = setup(t, async () => { calls++; return json({}) })
  const other = createApiQueries(api, 'scope-b')
  const options = [
    queries.footfall(range),
    queries.footfall({ ...range, siteId: '<site-b>' }),
    queries.footfall({ ...range, toUtc: range.toUtc + 1000 }),
    queries.dwell(range),
    other.footfall(range),
    queries.entryExit({ ...range, pageNumber: 1 }),
    queries.entryExit({ ...range, pageNumber: 2 }),
  ]
  await Promise.all(options.map(option => client.fetchQuery(option)))
  assert.equal(calls, options.length)
  assert.equal(client.getQueryCache().getAll().length, options.length)
  for (const option of options) assert.ok(!JSON.stringify(option.queryKey).includes('unit-session'))
  assert.deepEqual(queries.entryExit(range).queryKey, queries.entryExit({ ...range, pageSize: 50, pageNumber: 1 }).queryKey)
})

test('query definitions snapshot the request so later UI mutations cannot mismatch the cache key', async t => {
  let sent
  const { client, queries } = setup(t, async (_, init) => {
    sent = JSON.parse(init.body)
    return json({ ...sent, footfall: 3 })
  })
  const mutable = { ...range }
  const options = queries.footfall(mutable)
  mutable.siteId = '<different-site>'
  mutable.fromUtc = 500
  const data = await client.fetchQuery(options)
  assert.deepEqual(sent, range)
  assert.equal(data.siteId, range.siteId)
  assert.deepEqual(options.queryKey, ['dashboard', 'scope-a', 'footfall', range.siteId, range.fromUtc, range.toUtc])
})

test('logout cleanup aborts pending work and removes only that session without a late cache write', async t => {
  let aborted = false
  let finish
  const { client, api, queries } = setup(t, async (url, { signal }) => {
    if (url.endsWith('/sites')) return json([])
    signal.addEventListener('abort', () => { aborted = true }, { once: true })
    // Even a transport that resolves late must not repopulate a removed query.
    return new Promise(resolve => { finish = resolve })
  })
  const other = createApiQueries(api, 'scope-b').sites()
  await client.fetchQuery(other)
  const options = queries.footfall(range)
  const pending = client.fetchQuery(options)
  const cancelled = assert.rejects(pending, isCancelledError)
  await clearSessionQueries(client, 'scope-a')
  await cancelled
  assert.equal(aborted, true)
  finish(json({ ...range, footfall: 99 }))
  await Promise.resolve()
  await Promise.resolve()
  assert.equal(client.getQueryData(options.queryKey), undefined)
  assert.deepEqual(client.getQueryData(other.queryKey), [])
  assert.equal(client.getQueryCache().getAll().length, 1)
})

test('errors are not retried or presented as zero data; automatic refresh sources are disabled', async t => {
  let calls = 0
  const { client, queries } = setup(t, async () => { calls++; return json({}, 500) })
  const options = queries.footfall(range)
  await assert.rejects(client.fetchQuery(options), error => error.kind === 'http')
  assert.equal(calls, 1)
  const state = client.getQueryState(options.queryKey)
  assert.equal(state.status, 'error')
  assert.equal(state.data, undefined)
  const defaults = client.getDefaultOptions().queries
  assert.equal(defaults.retry, false)
  assert.equal(defaults.refetchInterval, false)
  assert.equal(defaults.refetchOnWindowFocus, false)
  assert.equal(defaults.refetchOnReconnect, false)
  assert.equal(defaults.staleTime, 30_000)
})

test('query-layer 429 keeps the server deadline and does not retry', async t => {
  let calls = 0
  const { client, queries } = setup(t, async () => {
    calls++
    return json({}, 429, { 'Retry-After': '60' })
  })
  await assert.rejects(client.fetchQuery(queries.sites()), error => error.status === 429 && error.retryAt > Date.now())
  assert.equal(calls, 1)
  await assert.rejects(client.fetchQuery(queries.footfall(range)), error => error.kind === 'rate-limit')
  assert.equal(calls, 1)
})
