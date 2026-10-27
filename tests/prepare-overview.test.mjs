import assert from 'node:assert/strict'
import test from 'node:test'
import { ApiError } from '../src/api/client.ts'
import { createApiQueries } from '../src/api/queries.ts'
import { createApiQueryClient } from '../src/api/query-client.ts'
import { prepareOverview } from '../src/api/prepare-overview.ts'

const range = { fromUtc: 86_400_000, toUtc: 90_000_000, previous: { fromUtc: 0, toUtc: 3_600_000 }, label: 'Test day', isToday: true }
function setup(t, read = async () => ({})) {
  const cache = createApiQueryClient(), calls = []
  t.after(() => cache.clear())
  const api = Object.fromEntries(['footfall', 'dwell', 'occupancy', 'demographics'].map(metric => [metric, (period, signal) => { calls.push({ metric, period, signal }); return read(metric, period, signal) }]))
  return { cache, calls, queries: createApiQueries(api, 'synthetic-scope') }
}

test('a background snapshot prepares four current metrics and three prior metrics before display', async t => {
  const env = setup(t), abort = new AbortController()
  await prepareOverview(env.cache, env.queries, 'site-a', range, abort.signal)
  assert.equal(env.calls.length, 7)
  assert.deepEqual(env.calls.map(c => c.metric), ['footfall', 'dwell', 'occupancy', 'demographics', 'footfall', 'dwell', 'occupancy'])
  for (const call of env.calls) { assert.equal(call.period.siteId, 'site-a'); assert.equal(call.signal.aborted, false) }
  assert.deepEqual(env.cache.getQueryData(env.queries.footfall({ siteId: 'site-a', fromUtc: range.fromUtc, toUtc: range.toUtc }).queryKey), {})
  assert.equal(env.cache.getQueryCache().getAll().length, 7)
})

test('current failures reject the next snapshot while ordinary comparison failures are optional', async t => {
  const current = setup(t, async (metric, period) => { if (metric === 'dwell' && period.fromUtc === range.fromUtc) throw new Error('private transport details'); return {} })
  await assert.rejects(prepareOverview(current.cache, current.queries, 'site-a', range, new AbortController().signal), error => error.kind === 'network' && !error.message.includes('private'))
  const previous = setup(t, async (_metric, period) => { if (period.fromUtc === 0) throw new ApiError('http', 'Unavailable'); return {} })
  await prepareOverview(previous.cache, previous.queries, 'site-a', range, new AbortController().signal)
})

test('all rate-limit failures preserve the longest deadline; an unknown deadline pauses', async t => {
  const known = setup(t, async (metric, period) => { if (period.fromUtc === 0) throw new ApiError('rate-limit', 'Wait', { retryAt: metric === 'dwell' ? 200_000 : 150_000 }); return {} })
  assert.deepEqual(await prepareOverview(known.cache, known.queries, 'site-a', range, new AbortController().signal), { retryAt: 200_000 })
  const unknown = setup(t, async (_metric, period) => { if (period.fromUtc === 0) throw new ApiError('rate-limit', 'Wait'); throw new ApiError('http', 'Unavailable') })
  await assert.rejects(prepareOverview(unknown.cache, unknown.queries, 'site-a', range, new AbortController().signal), error => error.kind === 'rate-limit' && error.retryAt === null)
})

test('cancellation reaches every request and rejects even transports that resolve late', async t => {
  const finish = []
  const env = setup(t, () => new Promise(resolve => finish.push(resolve)))
  const abort = new AbortController()
  const pending = prepareOverview(env.cache, env.queries, 'site-a', range, abort.signal)
  abort.abort()
  assert.ok(env.calls.every(call => call.signal.aborted))
  finish.forEach(resolve => resolve({}))
  await assert.rejects(pending, error => error.name === 'AbortError')
})
