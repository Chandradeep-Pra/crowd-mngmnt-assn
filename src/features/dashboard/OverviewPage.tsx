import { useQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import type { createApiQueries } from '../../api/queries.ts'
import type { Site } from '../../api/contracts.ts'
import type { TimeWindow } from '../../domain/time.ts'
import { formatTime, number, percentChange } from '../../domain/time.ts'
import { compareOccupancyHours, dwellText, finite, occupancyPoints } from '../../domain/analytics.ts'
import { Button } from '../../components/ui/Controls.tsx'
import { EmptyState, Metric, Notice, StatusBadge, Surface } from '../../components/ui/Display.tsx'
import { TimeSeriesChart } from '../../components/ui/TimeSeriesChart.tsx'
import { DataBoundary } from '../shared/DataFeedback.tsx'
import type { LiveState } from '../shared/use-realtime.ts'
import { MovementList } from '../shared/MovementList.tsx'
import { Demographics } from './Demographics.tsx'
import { OccupancyComparison } from './OccupancyComparison.tsx'

export interface OverviewProps { queries: ReturnType<typeof createApiQueries>; site: Site & { siteId: string; timezone: string }; window: TimeWindow; live: LiveState }
const occupancySeries = [{ key: 'occupancy', label: 'Average occupancy', color: 'var(--chart-primary)' }]
function Comparison({ current, previous, pending }: { current: unknown; previous: unknown; pending: boolean }) {
  const change = percentChange(current, previous)
  if (pending) return <span className="comparison">Loading comparison…</span>
  if (change === null) return <span className="comparison">Comparison unavailable</span>
  const Icon = change < 0 ? ArrowDownRight : ArrowUpRight
  return <span className="comparison"><Icon size={16} aria-hidden="true" />{number(Math.abs(change), 1)}% {change < 0 ? 'lower' : change > 0 ? 'higher' : 'change'} than previous window</span>
}
export default function OverviewPage({ queries, site, window, live }: OverviewProps) {
  const period = { siteId: site.siteId, fromUtc: window.fromUtc, toUtc: window.toUtc }
  const previous = { siteId: site.siteId, ...window.previous }
  const footfall = useQuery(queries.footfall(period))
  const dwell = useQuery(queries.dwell(period))
  const occupancy = useQuery(queries.occupancy(period))
  const demographics = useQuery(queries.demographics(period))
  const priorFootfall = useQuery(queries.footfall(previous))
  const priorDwell = useQuery(queries.dwell(previous))
  const priorOccupancy = useQuery(queries.occupancy(previous))
  const hourlyComparison = useMemo(() => compareOccupancyHours(occupancy.data?.buckets, priorOccupancy.isError ? undefined : priorOccupancy.data?.buckets, window, site.timezone), [occupancy.data?.buckets, priorOccupancy.data?.buckets, priorOccupancy.isError, window, site.timezone])
  const occupancyData = useMemo(() => occupancyPoints(occupancy.data?.buckets, site.timezone), [occupancy.data?.buckets, site.timezone])
  const hasDwell = finite(dwell.data?.dwellRecords) && dwell.data.dwellRecords > 0
  const priorHasDwell = finite(priorDwell.data?.dwellRecords) && priorDwell.data.dwellRecords > 0
  return <div className="overview-page app-stack">
    {live.message && <div className="live-connection-notice"><Notice heading="Live updates unavailable">{live.message} Historical results remain available.</Notice><Button variant="secondary" onClick={live.retry}>Reconnect</Button></div>}
    <section aria-labelledby="occupancy-heading"><div className="section-heading"><h2 id="occupancy-heading">Occupancy</h2></div><div className="summary-grid">
      <div className="summary-card"><Metric label="Live occupancy" value={live.live ? number(live.live.siteOccupancy) : '—'} detail={live.live ? `As of ${formatTime(live.live.ts, site.timezone, true)}` : live.status === 'connected' ? 'Waiting for an update' : 'Live data unavailable'} /><div className="summary-footer"><StatusBadge tone={live.live ? 'success' : 'neutral'}>{live.live ? 'Live' : 'Awaiting data'}</StatusBadge></div></div>
      <div className="summary-card"><DataBoundary pending={footfall.isPending} error={footfall.error} hasData={footfall.data !== undefined} retry={() => { void footfall.refetch() }}><Metric label={window.isToday ? 'Today’s footfall' : 'Footfall'} value={number(footfall.data?.footfall)} detail="Entries" /><div className="summary-footer"><Comparison current={footfall.data?.footfall} previous={priorFootfall.isError ? undefined : priorFootfall.data?.footfall} pending={priorFootfall.isPending} /></div></DataBoundary></div>
      <div className="summary-card"><DataBoundary pending={dwell.isPending} error={dwell.error} hasData={dwell.data !== undefined} retry={() => { void dwell.refetch() }}><Metric label="Average dwell time" value={hasDwell ? dwellText(dwell.data?.avgDwellMinutes) : dwell.data?.dwellRecords === 0 ? 'No dwell data' : 'Unavailable'} detail={hasDwell ? `${number(dwell.data?.dwellRecords)} records` : dwell.data?.dwellRecords === 0 ? 'No records' : 'Sample count unavailable'} /><div className="summary-footer"><Comparison current={hasDwell ? dwell.data?.avgDwellMinutes : undefined} previous={priorHasDwell && !priorDwell.isError ? priorDwell.data?.avgDwellMinutes : undefined} pending={priorDwell.isPending} /></div></DataBoundary></div>
    </div></section>
    <Surface heading="Hourly occupancy" actions={<OccupancyComparison comparison={hourlyComparison} pending={occupancy.isPending || priorOccupancy.isPending} timezone={site.timezone} />}><DataBoundary pending={occupancy.isPending} error={occupancy.error} hasData={occupancy.data !== undefined} retry={() => { void occupancy.refetch() }}>{occupancyData.length ? <TimeSeriesChart label="Occupancy over time" description={`Average people per hour · ${site.timezone}`} showHeading={false} data={occupancyData} series={occupancySeries} /> : <EmptyState heading={occupancy.data?.buckets ? 'No occupancy history' : 'Occupancy buckets unavailable'}>{occupancy.data?.buckets ? 'Try another date window or refresh to check for new records.' : 'The response did not include a bucket list.'}</EmptyState>}</DataBoundary></Surface>
    <section aria-labelledby="demographics-heading"><div className="section-heading"><h2 id="demographics-heading">Demographics</h2></div><DataBoundary pending={demographics.isPending} error={demographics.error} hasData={demographics.data !== undefined} retry={() => { void demographics.refetch() }}><Demographics key={window.fromUtc} response={demographics.data} timezone={site.timezone} /></DataBoundary></section>
    <div className="activity-zones-grid"><Surface heading="Recent movement">{live.alerts.length ? <MovementList events={live.alerts.slice(0, 5)} timezone={site.timezone} /> : <EmptyState heading="No movement received">Events appear after this site sends an entry or exit.</EmptyState>}</Surface><Surface heading="Zone presence">{site.zones?.length ? <ul className="zone-list">{site.zones.map((zone, index) => { const value = zone.zoneId ? live.zones[zone.zoneId] : undefined; return <li key={zone.zoneId ?? index}><div><strong>{zone.name || 'Unnamed zone'}</strong><p className="ui-muted">Security: {zone.securityLevel ?? 'Unavailable'}{value ? ` · ${formatTime(value.ts, site.timezone)}` : ''}</p></div><strong>{value ? number(value.count) : '—'}</strong></li> })}</ul> : <EmptyState heading="No zones supplied">Zone presence is unavailable for this site.</EmptyState>}</Surface></div>
  </div>
}
