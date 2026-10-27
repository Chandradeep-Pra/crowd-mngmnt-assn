import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { SessionProvider } from './auth/SessionProvider.tsx'
import { AppBoundary } from './components/AppBoundary.tsx'

const root = createRoot(document.getElementById('root')!)

root.render(
  <StrictMode>
    <AppBoundary><SessionProvider baseUrl={import.meta.env.VITE_API_BASE_URL ?? ''}>
      <App />
    </SessionProvider></AppBoundary>
  </StrictMode>,
)
