import { lazy, Suspense, useState, useSyncExternalStore } from 'react'
import { useIsFetching, useQuery, useQueryClient } from '@tanstack/react-query'
import type { createApiQueries } from '../../api/queries.ts'
import type { Site } from '../../api/contracts.ts'
import { useSession } from '../../auth/use-session.ts'
import { buildWindow, localDate, validTimezone, formatTime } from '../../domain/time.ts'
import type { DateSelection, TimeWindow } from '../../domain/time.ts'
import { Button } from '../../components/ui/Controls.tsx'
import { EmptyState, Notice, Skeleton, Surface } from '../../components/ui/Display.tsx'
import { DataError } from '../shared/DataFeedback.tsx'
import { useRealtime } from '../shared/use-realtime.ts'
import { useAnalyticsRefresh } from '../shared/use-analytics-refresh.ts'
import { AppShell } from './AppShell.tsx'
import type { Page } from './AppShell.tsx'
import { RangeFilters } from './RangeFilters.tsx'

const OverviewPage = lazy(() => import('../dashboard/OverviewPage.tsx'))
const EntriesPage = lazy(() => import('../entries/EntriesPage.tsx'))
type Queries = ReturnType<typeof createApiQueries>
type UsableSite = Site & { siteId: string; timezone: string }
const readPage = (): Page => window.location.hash.startsWith('#/entries') ? 'entries' : 'overview'
const subscribePage = (listener: () => void) => { window.addEventListener('hashchange', listener); return () => window.removeEventListener('hashchange', listener) }

function Workspace({ queries, site, sites, onSiteChange, page, scope }: { queries: Queries; site: UsableSite; sites: UsableSite[]; onSiteChange: (id: string) => void; page: Page; scope: string }) {
  const { signOut } = useSession()
  const live = useRealtime(site.siteId)
  const cache = useQueryClient()
  const [selection, setSelection] = useState<DateSelection>(() => ({ mode: 'today', from: localDate(Date.now(), site.timezone), to: localDate(Date.now(), site.timezone) }))
  const [range, setRange] = useState<TimeWindow | null>(() => { try { return buildWindow(selection, site.timezone, Date.now()) } catch { return null } })
  const [manualRevision, setManualRevision] = useState(0)
  const refreshFailure = useAnalyticsRefresh({ queries, scope, siteId: site.siteId, timezone: site.timezone, selection, page, live, manualRevision, onReady: setRange })
  const fetching = useIsFetching({ predicate: query => query.queryKey[1] === scope && query.queryKey[3] === site.siteId }) > 0
  function refresh() {
    setManualRevision(value => value + 1)
    try {
      const next = buildWindow(selection, site.timezone, Date.now())
      if (next.fromUtc === range?.fromUtc && next.toUtc === range?.toUtc) void cache.invalidateQueries({ predicate: query => query.queryKey[1] === scope && query.queryKey[3] === site.siteId })
      setRange(next)
    } catch { setRange(null) }
  }
  return <AppShell page={page} site={site} sites={sites} onSiteChange={onSiteChange} onLogout={() => { void signOut().catch(() => {}) }} live={live}>
    <RangeFilters timezone={site.timezone} page={page === 'overview' ? 'Overview' : 'Crowd Entries'} busy={fetching} onRefresh={refresh} onApply={(nextSelection, nextRange) => { setSelection(nextSelection); setRange(nextRange) }} />
    {refreshFailure && <Notice tone="error" heading="Analytics refresh">{refreshFailure}</Notice>}
    {range ? <><div className="window-caption"><span>{range.label} · {formatTime(range.fromUtc, site.timezone)} – {formatTime(range.toUtc, site.timezone)}</span><span>Site-local dates · up to 31 days</span></div><Suspense fallback={<Surface heading="Loading view"><Skeleton /></Surface>}><div key={page} className="app-view">{page === 'overview' ? <OverviewPage queries={queries} site={site} window={range} live={live} /> : <EntriesPage key={`${range.fromUtc}-${range.toUtc}`} queries={queries} siteId={site.siteId} timezone={site.timezone} window={range} />}</div></Suspense></> : <EmptyState heading="Select a valid time window">Apply a period using the controls above.</EmptyState>}
    <footer className="app-footer">Kloudspot · Crowd Solutions<span>Times shown in {site.timezone}</span></footer>
  </AppShell>
}

export default function AuthenticatedApp({ queries, scope }: { queries: Queries; scope: string }) {
  const { signOut } = useSession()
  const page = useSyncExternalStore(subscribePage, readPage, () => 'overview' as const)
  const sitesQuery = useQuery(queries.sites())
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const sites = [...new Map((sitesQuery.data ?? []).filter((site): site is UsableSite => typeof site.siteId === 'string' && Boolean(site.siteId) && validTimezone(site.timezone)).map(site => [site.siteId, site])).values()]
  const selected = sites.find(site => site.siteId === selectedId) ?? sites[0]
  if (!selected) return <AppShell page={page} sites={[]} onSiteChange={() => {}} onLogout={() => { void signOut().catch(() => {}) }}><div className="page-toolbar"><h1>{page === 'overview' ? 'Overview' : 'Crowd Entries'}</h1></div><Surface heading="Your sites">{sitesQuery.isPending ? <Skeleton label="Loading sites" /> : sitesQuery.error ? <DataError error={sitesQuery.error} retry={() => { void sitesQuery.refetch() }} /> : <EmptyState heading={sitesQuery.data?.length ? 'Site information is incomplete' : 'No sites available'} action={<Button variant="secondary" onClick={() => { void sitesQuery.refetch() }}>Refresh sites</Button>}>{sitesQuery.data?.length ? 'A site ID and a valid timezone are required. Ask your administrator to check the site configuration.' : 'This account has no available sites. Try refreshing or contact your administrator.'}</EmptyState>}</Surface></AppShell>
  return <Workspace key={selected.siteId} queries={queries} site={selected} sites={sites} onSiteChange={setSelectedId} page={page} scope={scope} />
}
