import { ApiError } from '../api/client.ts'

interface Options {
  refresh: () => Promise<{ retryAt?: number | null } | void>
  isBusy: () => boolean
  onError: (error: unknown) => void
  now?: () => number
  schedule?: (callback: () => void, delay: number) => () => void
}

/** Activity-driven coalescing, not an interval that polls idle analytics. */
export function createAnalyticsRefresh(options: Options) {
  const now = options.now ?? Date.now
  const schedule = options.schedule ?? ((callback, delay) => { const id = setTimeout(callback, delay); return () => clearTimeout(id) })
  let enabled = false, dirty = false, running = false, stopped = false, ratePaused = false
  let lastStarted = now(), blockedUntil = 0, failures = 0
  let cancel: (() => void) | null = null
  const wait = () => Math.max(0, lastStarted + Math.min(60_000, 15_000 * 2 ** failures) - now(), blockedUntil - now())
  function plan() {
    if (stopped || !enabled || ratePaused || !dirty || running || cancel) return
    cancel = schedule(() => { cancel = null; void run() }, Math.min(wait(), 2_147_483_647))
  }
  async function run() {
    if (stopped || !enabled || ratePaused || !dirty || running) return
    if (wait() > 0) { plan(); return }
    if (options.isBusy()) { blockedUntil = Math.max(blockedUntil, now() + 1_000); plan(); return }
    dirty = false
    running = true
    lastStarted = now()
    try {
      const result = await options.refresh()
      if (stopped) return
      failures = 0
      blockedUntil = Math.max(blockedUntil, result?.retryAt ?? 0)
    } catch (error) {
      if (stopped) return
      failures = Math.min(failures + 1, 2)
      if (error instanceof ApiError && error.kind === 'rate-limit') {
        if (error.retryAt === null) ratePaused = true
        else blockedUntil = Math.max(blockedUntil, error.retryAt)
      }
      options.onError(error)
    } finally { running = false; if (!stopped) plan() }
  }
  return {
    notify() { if (!stopped) { dirty = true; plan() } },
    setEnabled(value: boolean) {
      enabled = value
      if (!value) { cancel?.(); cancel = null }
      else plan()
    },
    stop() { stopped = true; dirty = false; cancel?.(); cancel = null },
  }
}
