import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { QueryClientProvider } from '@tanstack/react-query'
import { SessionContext } from './context.ts'
import { createSessionRuntime } from './session.ts'

export function SessionProvider({ baseUrl, children }: { baseUrl: string; children: ReactNode }) {
  const [runtime] = useState(() => createSessionRuntime({
    baseUrl, getStorage: () => window.sessionStorage,
  }))
  useEffect(() => {
    runtime.start()
    const onVisible = () => { if (document.visibilityState === 'visible') runtime.checkExpiry() }
    window.addEventListener('focus', runtime.checkExpiry)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener('focus', runtime.checkExpiry)
      document.removeEventListener('visibilitychange', onVisible)
      runtime.stop()
    }
  }, [runtime])
  return (
    <SessionContext.Provider value={runtime}>
      <QueryClientProvider client={runtime.queryClient}>{children}</QueryClientProvider>
    </SessionContext.Provider>
  )
}
