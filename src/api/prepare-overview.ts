import type { QueryClient } from '@tanstack/react-query'
import { ApiError } from './client.ts'
import type { createApiQueries } from './queries.ts'
import type { TimeWindow } from '../domain/time.ts'

/** Fetch into future range keys before displaying them, preserving the last good view. */
export async function prepareOverview(cache: QueryClient, queries: ReturnType<typeof createApiQueries>, siteId: string, range: TimeWindow, signal: AbortSignal) {
  const period = { siteId, fromUtc: range.fromUtc, toUtc: range.toUtc }
  const prior = { siteId, ...range.previous }
  const definitions = [queries.footfall(period), queries.dwell(period), queries.occupancy(period), queries.demographics(period), queries.footfall(prior), queries.dwell(prior), queries.occupancy(prior)]
  const results = await Promise.allSettled(definitions.map(definition => {
    const queryFn = definition.queryFn
    if (typeof queryFn !== 'function') throw new Error('Missing analytics query.')
    return cache.fetchQuery({
      queryKey: [...definition.queryKey], staleTime: 0, retry: false,
      queryFn: context => queryFn({ ...context, queryKey: definition.queryKey, signal: AbortSignal.any([context.signal, signal]) }),
    })
  }))
  if (signal.aborted) throw new DOMException('Refresh cancelled.', 'AbortError')
  let retryAt: number | null = null
  for (const result of results) if (result.status === 'rejected' && result.reason instanceof ApiError && result.reason.kind === 'rate-limit') {
    if (result.reason.retryAt === null) throw result.reason
    retryAt = Math.max(retryAt ?? 0, result.reason.retryAt)
  }
  const failure = results.slice(0, 4).find(result => result.status === 'rejected')
  if (failure?.status === 'rejected') {
    if (retryAt !== null) throw new ApiError('rate-limit', 'Wait before refreshing analytics.', { status: 429, retryAt })
    throw failure.reason instanceof ApiError ? failure.reason : new ApiError('network', 'Unable to refresh analytics.')
  }
  return { retryAt }
}
