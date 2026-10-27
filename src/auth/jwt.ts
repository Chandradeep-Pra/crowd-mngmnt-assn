import { ApiError } from '../api/client.ts'

/** Read only the expiry hint. This does NOT verify a signature or grant permissions. */
export function jwtExpiry(token: string): number | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3 || parts.some(part => !/^[A-Za-z0-9_-]+$/.test(part))) throw new Error()
    const encoded = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const binary = atob(encoded.padEnd(Math.ceil(encoded.length / 4) * 4, '='))
    const payload: unknown = JSON.parse(new TextDecoder().decode(Uint8Array.from(binary, char => char.charCodeAt(0))))
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error()
    const exp = (payload as Record<string, unknown>).exp
    if (exp === undefined) return null
    if (typeof exp !== 'number' || !Number.isFinite(exp) || Math.abs(exp * 1000) > Number.MAX_SAFE_INTEGER) throw new Error()
    return Math.floor(exp * 1000) // JWT NumericDate is seconds; the app uses milliseconds.
  } catch {
    throw new ApiError('invalid-response', 'The session token is not usable. Sign in again.')
  }
}
