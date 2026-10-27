import { ApiError, createApiClient, normalizeBaseUrl } from '../api/client.ts'
import { createApiQueries, clearSessionQueries } from '../api/queries.ts'
import { createApiQueryClient } from '../api/query-client.ts'
import { loginResponseSchema } from '../api/contracts.ts'
import { createLoginService } from './login.ts'
import type { LoginCredentials } from './login.ts'
import { createRealtimeFeed } from '../realtime/feed.ts'
import type { SocketFactory } from '../realtime/feed.ts'
import { jwtExpiry } from './jwt.ts'

export const SESSION_STORAGE_KEY = 'crowdiq.session.v1'
export type SessionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type SignedOutReason = 'initial' | 'logout' | 'expired' | 'unauthorized' | 'invalid-session' | 'login-failed' | 'storage-unavailable'
export type SessionSnapshot = Readonly<
  | { status: 'restoring' }
  | { status: 'signing-in' }
  | { status: 'signed-out'; reason: SignedOutReason; message: string | null }
  | { status: 'signed-in'; scope: string; expiresAt: number | null }
>
export interface SessionOptions {
  baseUrl: string
  getStorage: () => SessionStorage
  fetcher?: typeof fetch
  now?: () => number
  createScope?: () => string
  schedule?: (callback: () => void, delay: number) => () => void
}

const initialSnapshot: SessionSnapshot = Object.freeze({ status: 'restoring' })
const defaultSchedule = (callback: () => void, delay: number) => {
  const timer = setTimeout(callback, delay)
  return () => clearTimeout(timer)
}

/** Side-effect-free construction; start/stop belong to the provider lifecycle. */
export function createSessionRuntime(options: SessionOptions) {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const now = options.now ?? Date.now
  const createScope = options.createScope ?? (() => globalThis.crypto.randomUUID())
  const schedule = options.schedule ?? defaultSchedule
  const login = createLoginService({ baseUrl, fetcher: options.fetcher, now })
  const queryClient = createApiQueryClient()
  const listeners = new Set<() => void>()
  const liveCleanups = new Set<() => void>()
  let snapshot = initialSnapshot
  let active = false
  let initialized = false
  let token: string | null = null
  let scope: string | null = null
  let expiresAt: number | null = null
  let queries: ReturnType<typeof createApiQueries> | null = null
  let attempt = 0
  let pending: AbortController | null = null
  let cancelExpiry: (() => void) | null = null

  function publish(next: SessionSnapshot) {
    snapshot = Object.freeze(next)
    for (const listener of listeners) listener()
  }
  function stopTimer() {
    cancelExpiry?.()
    cancelExpiry = null
  }
  function stopLive() { for (const stop of [...liveCleanups]) stop() }
  function clearSavedSession() {
    try {
      const storage = options.getStorage()
      storage.removeItem(SESSION_STORAGE_KEY)
      if (storage.getItem(SESSION_STORAGE_KEY) !== null) throw new Error()
    } catch {
      throw new ApiError('configuration', 'The saved session could not be cleared. Clear this site’s session storage before reloading.')
    }
  }
  function saveSession(nextToken: string) {
    try {
      const storage = options.getStorage()
      const value = JSON.stringify({ token: nextToken })
      storage.setItem(SESSION_STORAGE_KEY, value)
      if (storage.getItem(SESSION_STORAGE_KEY) !== value) throw new Error()
    } catch {
      throw new ApiError('configuration', 'Session storage is unavailable. Enable it to stay signed in after reloads.')
    }
  }

  async function endSession(reason: SignedOutReason, expectedScope?: string) {
    if (expectedScope !== undefined && scope !== expectedScope) return
    attempt++
    pending?.abort()
    pending = null
    stopTimer()
    stopLive()
    const previous = scope
    token = null
    scope = null
    expiresAt = null
    queries = null
    let storageError: ApiError | null = null
    try { clearSavedSession() } catch (error) { storageError = error as ApiError }
    publish({
      status: 'signed-out', reason: storageError ? 'storage-unavailable' : reason,
      message: storageError?.message ?? (reason === 'expired' || reason === 'unauthorized' ? 'Your session ended. Sign in again.' : null),
    })
    if (previous) await clearSessionQueries(queryClient, previous)
    if (storageError) throw storageError
  }
  function endInBackground(reason: SignedOutReason, expectedScope: string) {
    void endSession(reason, expectedScope).catch(() => {
      // Any storage failure is already represented in the public signed-out state.
    })
  }
  function checkExpiry() {
    stopTimer()
    if (!active || !scope || expiresAt === null) return
    const remaining = expiresAt - now()
    if (remaining <= 0) {
      endInBackground('expired', scope)
      return
    }
    // Long-lived tokens must not overflow the browser's signed 32-bit timer delay.
    cancelExpiry = schedule(checkExpiry, Math.min(remaining, 2_147_483_647))
  }
  function buildQueries(nextScope: string) {
    const api = createApiClient({
      baseUrl, fetcher: options.fetcher, now,
      getAccessToken: () => {
        if (!active || scope !== nextScope) return null
        if (expiresAt !== null && expiresAt <= now()) {
          queueMicrotask(() => endInBackground('expired', nextScope))
          return null
        }
        return token
      },
      onUnauthorized: () => endInBackground('unauthorized', nextScope),
    })
    return createApiQueries(api, nextScope)
  }
  function commit(nextToken: string, nextExpiry: number | null, nextScope: string, nextQueries: ReturnType<typeof createApiQueries>) {
    token = nextToken
    expiresAt = nextExpiry
    scope = nextScope
    queries = nextQueries
    publish({ status: 'signed-in', scope, expiresAt })
    checkExpiry()
  }
  function restore() {
    let value: string | null
    try { value = options.getStorage().getItem(SESSION_STORAGE_KEY) } catch {
      publish({ status: 'signed-out', reason: 'storage-unavailable', message: 'Session storage is unavailable. Enable it to stay signed in after reloads.' })
      return
    }
    if (!value) {
      publish({ status: 'signed-out', reason: 'initial', message: null })
      return
    }
    let reason: SignedOutReason = 'invalid-session'
    try {
      const saved = loginResponseSchema.parse(JSON.parse(value))
      const expiry = jwtExpiry(saved.token)
      if (expiry !== null && expiry <= now()) {
        reason = 'expired'
        throw new Error()
      }
      const nextScope = createScope()
      commit(saved.token, expiry, nextScope, buildQueries(nextScope))
      return
    } catch {
      try { clearSavedSession() } catch {
        publish({ status: 'signed-out', reason: 'storage-unavailable', message: 'The saved session could not be cleared. Clear this site’s session storage before reloading.' })
        return
      }
      publish({ status: 'signed-out', reason, message: 'Your saved session is no longer usable. Sign in again.' })
    }
  }

  async function signIn(credentials: LoginCredentials): Promise<void> {
    if (!active) throw new ApiError('configuration', 'The session service is not active.')
    const id = ++attempt
    pending?.abort()
    const controller = new AbortController()
    pending = controller
    stopTimer()
    stopLive()
    const previous = scope
    token = null
    scope = null
    expiresAt = null
    queries = null
    publish({ status: 'signing-in' })
    const assertCurrent = () => {
      if (!active || id !== attempt || controller.signal.aborted) throw new DOMException('Sign-in was cancelled.', 'AbortError')
    }
    try {
      if (previous) await clearSessionQueries(queryClient, previous)
      assertCurrent()
      clearSavedSession()
      const nextToken = await login(credentials, controller.signal)
      assertCurrent()
      const expiry = jwtExpiry(nextToken)
      if (expiry !== null && expiry <= now()) throw new ApiError('authentication', 'The returned session has expired. Sign in again.')
      const nextScope = createScope()
      const nextQueries = buildQueries(nextScope)
      saveSession(nextToken)
      commit(nextToken, expiry, nextScope, nextQueries)
    } catch (error) {
      if (!active || id !== attempt || controller.signal.aborted) throw new DOMException('Sign-in was cancelled.', 'AbortError')
      stopTimer()
      token = null
      scope = null
      expiresAt = null
      queries = null
      let failure = error instanceof ApiError ? error : new ApiError('network', 'Unable to sign in. Please try again.')
      try { clearSavedSession() } catch (storageError) { failure = storageError as ApiError }
      publish({ status: 'signed-out', reason: failure.kind === 'configuration' ? 'storage-unavailable' : 'login-failed', message: failure.message })
      throw failure
    } finally {
      if (pending === controller) pending = null
    }
  }

  return {
    queryClient,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    getSnapshot: () => snapshot,
    getServerSnapshot: () => initialSnapshot,
    getQueries: () => active && snapshot.status === 'signed-in' ? queries : null,
    createFeed(siteId: string, createSocket: SocketFactory) {
      const expected = scope
      const feed = createRealtimeFeed({
        origin: baseUrl, siteId, createSocket,
        getToken: () => active && expected !== null && scope === expected && (expiresAt === null || expiresAt > now()) ? token : null,
        onUnauthorized: () => { if (expected) endInBackground('unauthorized', expected) },
      })
      const stop = () => { feed.stop(); liveCleanups.delete(stop) }
      return { ...feed, start() { if (active && scope === expected && expected) { liveCleanups.add(stop); feed.start() } }, stop }
    },
    signIn,
    signOut: () => endSession('logout'),
    checkExpiry,
    start() {
      if (active) return
      active = true
      if (!initialized) {
        initialized = true
        restore()
      } else if (snapshot.status === 'signing-in') {
        publish({ status: 'signed-out', reason: 'initial', message: null })
      }
      checkExpiry()
    },
    stop() {
      active = false
      attempt++
      pending?.abort()
      pending = null
      stopTimer()
      stopLive()
      queryClient.clear()
      // Preserve sessionStorage for reload; StrictMode may immediately start again.
    },
  }
}

export type SessionRuntime = ReturnType<typeof createSessionRuntime>
