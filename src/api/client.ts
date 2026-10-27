import type { z } from 'zod'
import {
  analyticsPeriodRequestSchema,
  apiContracts,
} from './contracts.ts'
import type { AnalyticsPeriodRequest } from './contracts.ts'

export type ApiErrorKind =
  | 'configuration' | 'invalid-request' | 'network' | 'invalid-response'
  | 'authentication' | 'authorization' | 'rate-limit' | 'http'

export class ApiError extends Error {
  readonly kind: ApiErrorKind
  readonly status: number | null
  readonly retryAt: number | null

  constructor(
    kind: ApiErrorKind,
    message: string,
    details: { status?: number; retryAt?: number | null } = {},
  ) {
    super(message)
    this.name = 'ApiError'
    this.kind = kind
    this.status = details.status ?? null
    this.retryAt = details.retryAt ?? null
  }
}

export type EntryExitInput = AnalyticsPeriodRequest & {
  pageSize?: number
  pageNumber?: number
}

export function normalizePeriod(input: AnalyticsPeriodRequest): AnalyticsPeriodRequest {
  const result = analyticsPeriodRequestSchema.safeParse(input)
  if (!result.success || !result.data.siteId.trim() || result.data.fromUtc >= result.data.toUtc) {
    throw new ApiError('invalid-request', 'Select a site and a valid, bounded UTC time range.')
  }
  // Snapshot known fields so later UI mutations and unrelated fields cannot alter a request.
  const { siteId, fromUtc, toUtc } = result.data
  return { siteId, fromUtc, toUtc }
}

export function normalizeEntryExit(input: EntryExitInput) {
  const period = normalizePeriod(input)
  const pageSize = input.pageSize ?? apiContracts.entryExit.documentedDefaults.pageSize
  const pageNumber = input.pageNumber ?? apiContracts.entryExit.documentedDefaults.pageNumber
  // Client policy for bounded reads, not an assertion about server validation.
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || !Number.isSafeInteger(pageNumber) || pageNumber < 1) {
    throw new ApiError('invalid-request', 'Page size and page number must be positive integers.')
  }
  return { ...period, pageSize, pageNumber }
}

export function normalizeSiteId(id: string): string {
  if (typeof id !== 'string' || !id.trim() || id === '.' || id === '..') {
    throw new ApiError('invalid-request', 'Select a valid site.')
  }
  return id
}

export function normalizeBaseUrl(input: string): string {
  try {
    if (typeof input !== 'string' || /[\\?#]/.test(input)) throw new Error()
    // Empty or root-relative prefixes support a future same-origin development proxy.
    if (input === '' || (input.startsWith('/') && !input.startsWith('//'))) {
      return input.replace(/\/+$/, '')
    }
    const url = new URL(input)
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error()
    return url.href.replace(/\/+$/, '')
  } catch {
    throw new ApiError('configuration', 'Configure an HTTP API origin or a same-origin path prefix without credentials, query or fragment.')
  }
}

export function retryTime(header: string | null, now: number): number | null {
  if (!header) return null
  const value = header.trim()
  const deadline = /^\d+$/.test(value)
    ? now + Number(value) * 1000
    : /^[A-Za-z]/.test(value) ? Date.parse(value) : NaN
  return Number.isSafeInteger(deadline) && deadline >= now ? deadline : null
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw new DOMException('The request was cancelled.', 'AbortError')
}

/** Frontend timeout policy, not a server rate limit; preserve caller cancellation. */
export function requestSignal(signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(20_000)
  return signal ? AbortSignal.any([signal, timeout]) : timeout
}

export interface ApiClientOptions {
  /** Server origin/path prefix; operations already include /api. No network call occurs at construction. */
  baseUrl: string
  getAccessToken: () => string | null
  onUnauthorized?: () => void
  fetcher?: typeof fetch
  now?: () => number
}

export function createApiClient(options: ApiClientOptions) {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
  const now = options.now ?? Date.now
  let cooldown: { token: string; retryAt: number } | null = null

  async function request<S extends z.ZodType>(
    method: 'GET' | 'POST', path: string, schema: S,
    body?: AnalyticsPeriodRequest, signal?: AbortSignal,
  ): Promise<z.infer<S>> {
    throwIfAborted(signal)
    const token = options.getAccessToken()
    if (!token?.trim()) throw new ApiError('authentication', 'Sign in to load dashboard data.')
    if (cooldown?.token !== token) cooldown = null
    if (cooldown && cooldown.retryAt > now()) {
      throw new ApiError('rate-limit', 'Wait for the server retry time before refreshing.', {
        status: 429, retryAt: cooldown.retryAt,
      })
    }

    let headers: Headers
    try {
      headers = new Headers({ Accept: 'application/json', Authorization: `Bearer ${token}` })
      if (body) headers.set('Content-Type', 'application/json')
    } catch {
      throw new ApiError('authentication', 'The session credential cannot be used. Sign in again.')
    }

    let response: Response
    try {
      response = await fetcher(`${baseUrl}${path}`, {
        method, headers, signal: requestSignal(signal),
        body: body ? JSON.stringify(body) : undefined,
        credentials: 'omit', redirect: 'error', cache: 'no-store',
      })
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw new DOMException('The request was cancelled.', 'AbortError')
      }
      // Never retain raw fetch errors, response bodies, credentials or request payloads.
      throw new ApiError('network', 'The API could not be reached. Check the connection and try again.')
    }

    throwIfAborted(signal)
    if (!response.ok) {
      if (response.status === 401) {
        if (options.getAccessToken() === token) {
          try {
            options.onUnauthorized?.()
          } catch {
            // A consumer callback must not replace the safe HTTP error below.
          }
        }
        throw new ApiError('authentication', 'The session is not authorized. Sign in again.', { status: 401 })
      }
      if (response.status === 403) {
        throw new ApiError('authorization', 'This account cannot access the requested data.', { status: 403 })
      }
      if (response.status === 429) {
        let retryAt = retryTime(response.headers.get('Retry-After'), now())
        const previous = cooldown?.token === token && cooldown.retryAt > now() ? cooldown.retryAt : null
        if (options.getAccessToken() === token && (retryAt !== null || previous !== null)) {
          // Concurrent responses must not shorten an earlier server-directed wait.
          retryAt = Math.max(retryAt ?? 0, previous ?? 0)
          cooldown = { token, retryAt }
        }
        throw new ApiError('rate-limit', 'The API is receiving too many requests. Try again later.', {
          status: 429, retryAt,
        })
      }
      throw new ApiError('http', `The API request failed (HTTP ${response.status}).`, { status: response.status })
    }

    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      throwIfAborted(signal)
      throw new ApiError('invalid-response', 'The API did not return valid JSON.', { status: response.status })
    }
    throwIfAborted(signal)
    const result = schema.safeParse(payload)
    if (!result.success) {
      throw new ApiError('invalid-response', 'The API response does not match its recorded model.', { status: response.status })
    }
    if (body && result.data && typeof result.data === 'object') {
      const echoed = result.data as Record<string, unknown>
      for (const field of ['siteId', 'fromUtc', 'toUtc'] as const) {
        if (echoed[field] !== undefined && echoed[field] !== body[field]) {
          throw new ApiError('invalid-response', 'The response belongs to a different site or time window.', { status: response.status })
        }
      }
    }
    return result.data
  }

  // Deliberately closed surface: no arbitrary endpoint, simulator, user-creation or login calls.
  return {
    async sites(signal?: AbortSignal) {
      return request('GET', apiContracts.sites.path, apiContracts.sites.responses[200], undefined, signal)
    },
    async site(id: string, signal?: AbortSignal) {
      const path = apiContracts.site.path.replace('{id}', encodeURIComponent(normalizeSiteId(id)))
      return request('GET', path, apiContracts.site.responses[200], undefined, signal)
    },
    async footfall(input: AnalyticsPeriodRequest, signal?: AbortSignal) {
      return request('POST', apiContracts.footfall.path, apiContracts.footfall.responses[200], normalizePeriod(input), signal)
    },
    async dwell(input: AnalyticsPeriodRequest, signal?: AbortSignal) {
      return request('POST', apiContracts.dwell.path, apiContracts.dwell.responses[200], normalizePeriod(input), signal)
    },
    async occupancy(input: AnalyticsPeriodRequest, signal?: AbortSignal) {
      return request('POST', apiContracts.occupancy.path, apiContracts.occupancy.responses[200], normalizePeriod(input), signal)
    },
    async demographics(input: AnalyticsPeriodRequest, signal?: AbortSignal) {
      return request('POST', apiContracts.demographics.path, apiContracts.demographics.responses[200], normalizePeriod(input), signal)
    },
    async entryExit(input: EntryExitInput, signal?: AbortSignal) {
      return request('POST', apiContracts.entryExit.path, apiContracts.entryExit.responses[200], normalizeEntryExit(input), signal)
    },
  }
}

export type ApiClient = ReturnType<typeof createApiClient>
