import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import type { createApiQueries } from '../../api/queries.ts'
import { prepareOverview } from '../../api/prepare-overview.ts'
import { ApiError } from '../../api/client.ts'
import { buildWindow } from '../../domain/time.ts'
import type { DateSelection, TimeWindow } from '../../domain/time.ts'
import { createAnalyticsRefresh } from '../../realtime/analytics-refresh.ts'
import type { LiveState } from './use-realtime.ts'

export function useAnalyticsRefresh({ queries, scope, siteId, timezone, selection, page, live, manualRevision, onReady }: {
  queries: ReturnType<typeof createApiQueries>; scope: string; siteId: string; timezone: string
  selection: DateSelection; page: string; live: LiveState; manualRevision: number; onReady: (range: TimeWindow) => void
}) {
  const cache = useQueryClient()
  const controllerRef = useRef<ReturnType<typeof createAnalyticsRefresh> | null>(null)
  const [failure, setFailure] = useState<{ message: string; selection: DateSelection; revision: number } | null>(null)
  // onReady is a React state setter, so it has stable identity.
  useEffect(() => {
    let current = true
    let pending: AbortController | null = null
    const controller = createAnalyticsRefresh({
      isBusy: () => cache.isFetching({ predicate: query => query.queryKey[1] === scope && query.queryKey[3] === siteId }) > 0,
      refresh: async () => {
        const abort = new AbortController()
        pending = abort
        try {
          const next = buildWindow(selection, timezone, Date.now())
          const result = await prepareOverview(cache, queries, siteId, next, abort.signal)
          if (current && !abort.signal.aborted) { onReady(next); setFailure(null) }
          return result
        } finally { if (pending === abort) pending = null }
      },
      onError: error => {
        if (current) setFailure({ message: error instanceof ApiError && error.kind === 'rate-limit' ? 'Automatic refresh paused. Use Refresh after the server wait.' : 'Automatic refresh failed. Showing the previous results.', selection, revision: manualRevision })
      },
    })
    controllerRef.current = controller
    const visibility = () => controller.setEnabled(document.visibilityState === 'visible' && page === 'overview' && selection.mode === 'today' && live.status === 'connected')
    document.addEventListener('visibilitychange', visibility)
    visibility()
    // A connection/reconnection also schedules a bounded catch-up.
    controller.notify()
    return () => {
      current = false
      pending?.abort()
      controller.stop()
      controllerRef.current = null
      document.removeEventListener('visibilitychange', visibility)
    }
  }, [cache, queries, scope, siteId, timezone, selection, page, live.status, manualRevision, onReady])
  useEffect(() => { controllerRef.current?.notify() }, [live.revision])
  return page === 'overview' && failure?.selection === selection && failure.revision === manualRevision ? failure.message : null
}
