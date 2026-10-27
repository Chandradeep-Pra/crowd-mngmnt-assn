import { useEffect, useState, useSyncExternalStore } from 'react'
import { io } from 'socket.io-client'
import { useSession } from '../../auth/use-session.ts'

export function useRealtime(siteId: string) {
  const { createFeed } = useSession()
  // The workspace is keyed by session and site; a new site gets an isolated feed.
  const [feed] = useState(() => createFeed(siteId, (origin, options) => io(origin, options)))
  const state = useSyncExternalStore(feed.subscribe, feed.getSnapshot, feed.getSnapshot)
  useEffect(() => { feed.start(); return feed.stop }, [feed])
  return { ...state, retry: feed.retry }
}
export type LiveState = ReturnType<typeof useRealtime>
