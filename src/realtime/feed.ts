import { alertEventSchema, liveEventSchema } from './contracts.ts'
import type { LiveEvent, Movement } from './contracts.ts'

export interface FeedSocket {
  auth: unknown
  on(event: string, listener: (...args: unknown[]) => void): unknown
  connect(): unknown
  disconnect(): unknown
  removeAllListeners(): unknown
}
export interface FeedOptions {
  auth: (callback: (payload: { token: string }) => void) => void
  path: string; transports: ['websocket']; autoConnect: false; forceNew: true
  reconnection: true; reconnectionAttempts: number; reconnectionDelay: number; reconnectionDelayMax: number; timeout: number
}
export type SocketFactory = (origin: string, options: FeedOptions) => FeedSocket
export interface FeedState {
  status: 'idle' | 'connecting' | 'connected' | 'disconnected' | 'error'
  live: LiveEvent | null
  zones: Readonly<Record<string, { count: number; ts: number }>>
  alerts: readonly Movement[]
  message: string | null
  revision: number
}
interface Options {
  origin: string; siteId: string; getToken: () => string | null; createSocket: SocketFactory
  onUnauthorized: () => void
  schedule?: (callback: () => void, delay: number) => () => void
}
export function createRealtimeFeed(options: Options) {
  let state: FeedState = { status: 'idle', live: null, zones: {}, alerts: [], message: null, revision: 0 }
  let socket: FeedSocket | null = null
  let cancelPublish: (() => void) | null = null
  let generation = 0
  const listeners = new Set<() => void>()
  const seen = new Set<string>()
  const schedule = options.schedule ?? ((callback, delay) => { const id = setTimeout(callback, delay); return () => clearTimeout(id) })
  let published = state
  function publish() { published = Object.freeze({ ...state }); listeners.forEach(listener => listener()) }
  function soon() { cancelPublish ??= schedule(() => { cancelPublish = null; publish() }, 250) }
  function close() {
    generation++
    cancelPublish?.(); cancelPublish = null
    if (socket) { socket.auth = {}; socket.removeAllListeners(); socket.disconnect(); socket = null }
  }
  function start() {
    if (socket) return
    if (!options.getToken()) { state = { ...state, status: 'error', live: null, zones: {}, message: 'Sign in again to connect live updates.' }; publish(); return }
    const id = ++generation
    state = { ...state, status: 'connecting', live: null, zones: {}, message: null }; publish()
    try {
      socket = options.createSocket(options.origin, {
        auth: callback => {
          const token = id === generation ? options.getToken() : null
          if (token) callback({ token })
        },
        path: '/socket.io/', transports: ['websocket'], autoConnect: false, forceNew: true,
        reconnection: true, reconnectionAttempts: 5, reconnectionDelay: 1_000, reconnectionDelayMax: 10_000, timeout: 8_000,
      })
      socket.on('connect', () => {
        if (id !== generation) return
        state = { ...state, status: 'connected', live: null, zones: {}, message: null }; publish()
      })
      socket.on('disconnect', () => {
        if (id !== generation) return
        state = { ...state, status: 'disconnected', live: null, zones: {}, message: 'Live connection interrupted. Waiting for reconnection.' }; publish()
      })
      socket.on('connect_error', error => {
        if (id !== generation) return
        const authentication = error instanceof Error && /auth|token|jwt/i.test(error.message)
        state = { ...state, status: 'error', live: null, zones: {}, message: authentication ? 'Live authentication failed. Sign in again.' : 'Live connection unavailable. Retry when your connection is ready.' }
        publish()
        if (authentication) { close(); options.onUnauthorized() }
      })
      socket.on('live_occupancy', payload => {
        if (id !== generation || state.status !== 'connected') return
        const parsed = liveEventSchema.safeParse(payload)
        if (!parsed.success || parsed.data.siteId !== options.siteId) return
        const event = parsed.data
        const zones = { ...state.zones }
        if (event.zoneId && event.zoneOccupancy !== undefined && (!zones[event.zoneId] || event.ts >= zones[event.zoneId].ts)) {
          // Site metadata is bounded; cap unknown zone IDs to prevent unbounded socket state.
          if (zones[event.zoneId] || Object.keys(zones).length < 200) zones[event.zoneId] = { count: event.zoneOccupancy, ts: event.ts }
        }
        const newer = !state.live || event.ts > state.live.ts || (event.ts === state.live.ts && event.siteOccupancy !== state.live.siteOccupancy)
        state = { ...state, zones, live: !state.live || event.ts >= state.live.ts ? event : state.live, revision: state.revision + (newer ? 1 : 0) }; soon()
      })
      socket.on('alert', payload => {
        if (id !== generation || state.status !== 'connected') return
        const parsed = alertEventSchema.safeParse(payload)
        if (!parsed.success || parsed.data.siteId !== options.siteId) return
        const event = parsed.data
        const key = event.eventId || JSON.stringify([event.siteId, event.zoneId, event.ts, event.direction, event.personId ?? event.personName])
        if (seen.has(key)) return
        seen.add(key)
        if (seen.size > 500) seen.delete(seen.values().next().value!)
        state = { ...state, revision: state.revision + 1, alerts: [{ ...event, key, receivedAt: Date.now() }, ...state.alerts].sort((a, b) => b.ts - a.ts).slice(0, 50) }; soon()
      })
      socket.connect()
    } catch {
      close(); state = { ...state, status: 'error', live: null, zones: {}, message: 'Unable to initialize live updates.' }; publish()
    }
  }
  return {
    start,
    stop() { close(); seen.clear(); state = { status: 'idle', live: null, zones: {}, alerts: [], message: null, revision: 0 }; publish() },
    retry() { close(); start() },
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    getSnapshot: () => published,
  }
}
export type RealtimeFeed = ReturnType<typeof createRealtimeFeed>
