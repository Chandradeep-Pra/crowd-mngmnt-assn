import { z } from 'zod'
import { ApiError, normalizeBaseUrl, requestSignal, retryTime } from '../api/client.ts'
import { apiContracts, loginResponseSchema } from '../api/contracts.ts'

// These are form/service requirements, distinct from Swagger's optional properties.
const credentialsSchema = z.object({
  email: z.string().trim().min(1),
  password: z.string().min(1),
})
export type LoginCredentials = z.infer<typeof credentialsSchema>

export interface LoginServiceOptions {
  baseUrl: string
  fetcher?: typeof fetch
  now?: () => number
}

/** Dedicated transport: credentials and the response never enter Query/Mutation caches. */
export function createLoginService(options: LoginServiceOptions) {
  const baseUrl = normalizeBaseUrl(options.baseUrl)
  const fetcher = options.fetcher ?? globalThis.fetch.bind(globalThis)
  const now = options.now ?? Date.now
  let retryAt: number | null = null

  return async function login(input: LoginCredentials, signal?: AbortSignal): Promise<string> {
    if (signal?.aborted) throw new DOMException('Sign-in was cancelled.', 'AbortError')
    const credentials = credentialsSchema.safeParse(input)
    if (!credentials.success) throw new ApiError('invalid-request', 'Enter your email and password.')
    if (retryAt !== null && retryAt > now()) {
      throw new ApiError('rate-limit', 'Wait for the server retry time before signing in again.', { status: 429, retryAt })
    }

    let response: Response
    try {
      response = await fetcher(`${baseUrl}${apiContracts.login.path}`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify(credentials.data),
        signal: requestSignal(signal), credentials: 'omit', redirect: 'error', cache: 'no-store',
      })
    } catch (error) {
      if (signal?.aborted || (error instanceof Error && error.name === 'AbortError')) {
        throw new DOMException('Sign-in was cancelled.', 'AbortError')
      }
      throw new ApiError('network', 'Unable to reach the sign-in service. Try again.')
    }
    if (signal?.aborted) throw new DOMException('Sign-in was cancelled.', 'AbortError')
    if (!response.ok) {
      if (response.status === 401) {
        throw new ApiError('authentication', 'Email or password is incorrect.', { status: 401 })
      }
      if (response.status === 429) {
        const next = retryTime(response.headers.get('Retry-After'), now())
        const previous = retryAt !== null && retryAt > now() ? retryAt : null
        retryAt = next === null && previous === null ? null : Math.max(next ?? 0, previous ?? 0)
        throw new ApiError('rate-limit', 'Too many sign-in attempts. Try again later.', { status: 429, retryAt })
      }
      throw new ApiError('http', `Sign-in failed (HTTP ${response.status}).`, { status: response.status })
    }
    let payload: unknown
    try {
      payload = await response.json()
    } catch {
      if (signal?.aborted) throw new DOMException('Sign-in was cancelled.', 'AbortError')
      throw new ApiError('invalid-response', 'The sign-in service returned invalid JSON.')
    }
    if (signal?.aborted) throw new DOMException('Sign-in was cancelled.', 'AbortError')
    const parsed = loginResponseSchema.safeParse(payload)
    if (!parsed.success) throw new ApiError('invalid-response', 'The sign-in response did not contain a usable token.')
    return parsed.data.token
  }
}
