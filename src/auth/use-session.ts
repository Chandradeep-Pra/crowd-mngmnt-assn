import { useContext, useSyncExternalStore } from 'react'
import { SessionContext } from './context.ts'

export function useSession() {
  const runtime = useContext(SessionContext)
  if (!runtime) throw new Error('useSession requires SessionProvider.')
  const state = useSyncExternalStore(runtime.subscribe, runtime.getSnapshot, runtime.getServerSnapshot)
  return {
    state,
    signIn: runtime.signIn,
    signOut: runtime.signOut,
    queries: state.status === 'signed-in' ? runtime.getQueries() : null,
    createFeed: runtime.createFeed,
  }
}
