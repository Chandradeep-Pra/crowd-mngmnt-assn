import { queryOptions } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import {
  ApiError, normalizeEntryExit, normalizePeriod, normalizeSiteId,
} from './client.ts'
import type { ApiClient, EntryExitInput } from './client.ts'
import type { AnalyticsPeriodRequest } from './contracts.ts'

function sessionKey(sessionScope: string) {
  if (!sessionScope.trim()) throw new ApiError('configuration', 'A query session scope is required.')
  return ['dashboard', sessionScope] as const
}

/** Pass a new opaque scope per authenticated session, never a JWT or password. */
export function createApiQueries(api: ApiClient, sessionScope: string) {
  const scope = sessionKey(sessionScope)
  const periodKey = (metric: string, period: AnalyticsPeriodRequest) =>
    [...scope, metric, period.siteId, period.fromUtc, period.toUtc] as const

  return {
    sites: () => queryOptions({
      queryKey: [...scope, 'sites'] as const,
      queryFn: ({ signal }) => api.sites(signal),
    }),
    site: (id: string) => {
      const siteId = normalizeSiteId(id)
      return queryOptions({
        queryKey: [...scope, 'site', siteId] as const,
        queryFn: ({ signal }) => api.site(siteId, signal),
      })
    },
    footfall: (input: AnalyticsPeriodRequest) => {
      const period = normalizePeriod(input)
      return queryOptions({
        queryKey: periodKey('footfall', period),
        queryFn: ({ signal }) => api.footfall(period, signal),
      })
    },
    dwell: (input: AnalyticsPeriodRequest) => {
      const period = normalizePeriod(input)
      return queryOptions({
        queryKey: periodKey('dwell', period),
        queryFn: ({ signal }) => api.dwell(period, signal),
      })
    },
    occupancy: (input: AnalyticsPeriodRequest) => {
      const period = normalizePeriod(input)
      return queryOptions({
        queryKey: periodKey('occupancy', period),
        queryFn: ({ signal }) => api.occupancy(period, signal),
      })
    },
    demographics: (input: AnalyticsPeriodRequest) => {
      const period = normalizePeriod(input)
      return queryOptions({
        queryKey: periodKey('demographics', period),
        queryFn: ({ signal }) => api.demographics(period, signal),
      })
    },
    entryExit: (input: EntryExitInput) => {
      const period = normalizeEntryExit(input)
      return queryOptions({
        queryKey: [...periodKey('entry-exit', period), period.pageSize, period.pageNumber] as const,
        queryFn: ({ signal }) => api.entryExit(period, signal),
      })
    },
  }
}

/** Use on logout/account change; cancellation prevents late results repopulating this scope. */
export async function clearSessionQueries(client: QueryClient, sessionScope: string) {
  const queryKey = sessionKey(sessionScope)
  await client.cancelQueries({ queryKey })
  client.removeQueries({ queryKey })
}
