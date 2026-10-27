import type { ReactNode } from 'react'
import { ApiError } from '../../api/client.ts'
import { Button } from '../../components/ui/Controls.tsx'
import { Notice, Skeleton } from '../../components/ui/Display.tsx'

export function DataError({ error, retry }: { error: unknown; retry: () => void }) {
  return <div className="app-stack"><Notice tone="error" heading={error instanceof ApiError && error.status === 429 ? 'Please wait before refreshing' : 'Unable to load this data'}>{error instanceof ApiError ? error.message : 'Try again when your connection is ready.'}</Notice><div><Button variant="secondary" onClick={retry}>Try again</Button></div></div>
}
export function DataBoundary({ pending, error, hasData, retry, children }: { pending: boolean; error: unknown; hasData: boolean; retry: () => void; children: ReactNode }) {
  if (pending && !hasData) return <Skeleton />
  if (error && !hasData) return <DataError error={error} retry={retry} />
  return <>{error && <Notice tone="error" heading="Refresh failed">Showing the previous response for this window. Try refreshing again.</Notice>}{children}</>
}
