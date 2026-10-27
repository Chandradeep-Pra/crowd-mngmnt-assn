import { lazy, Suspense } from 'react'
import { useSession } from './auth/use-session.ts'
import { Skeleton } from './components/ui/Display.tsx'
import LoginPage from './features/auth/LoginPage.tsx'
import './App.css'

const AuthenticatedApp = lazy(() => import('./features/layout/AuthenticatedApp.tsx'))
export default function App() {
  const { state, queries } = useSession()
  if (state.status === 'restoring') return <main className="session-loading"><h1>Crowd Solutions</h1><Skeleton label="Restoring your session" /></main>
  if (state.status !== 'signed-in' || !queries) return <LoginPage />
  return <Suspense fallback={<main className="session-loading"><h1>Opening your workspace</h1><Skeleton /></main>}><AuthenticatedApp key={state.scope} queries={queries} scope={state.scope} /></Suspense>
}
