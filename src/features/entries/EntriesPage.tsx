import { Select } from '../../components/ui/Select.tsx'
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { UserRound } from 'lucide-react'
import type { createApiQueries } from '../../api/queries.ts'
import type { TimeWindow } from '../../domain/time.ts'
import { formatTime, number } from '../../domain/time.ts'
import { dwellText } from '../../domain/analytics.ts'
import { Button } from '../../components/ui/Controls.tsx'
import { EmptyState, Pagination, Surface, TableFrame } from '../../components/ui/Display.tsx'
import { DataBoundary } from '../shared/DataFeedback.tsx'

export default function EntriesPage({ queries, siteId, timezone, window }: { queries: ReturnType<typeof createApiQueries>; siteId: string; timezone: string; window: TimeWindow }) {
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(25)
  const [filter, setFilter] = useState('all')
  const result = useQuery(queries.entryExit({ siteId, fromUtc: window.fromUtc, toUtc: window.toUtc, pageSize, pageNumber: page }))
  const records = result.data?.records ?? []
  const rows = records.filter(record => filter === 'all' || (filter === 'open' ? record.exitUtc === null : typeof record.exitUtc === 'number'))
  const reportedPages = result.data?.totalPages
  const totalPages = typeof reportedPages === 'number' && Number.isSafeInteger(reportedPages) && reportedPages >= 0 ? reportedPages : undefined
  return <Surface heading="Visit records" description={`${window.label} · all times in ${timezone}`} actions={<div className="entries-controls"><Select label="Rows per page" value={String(pageSize)} onValueChange={value => { setPageSize(Number(value)); setPage(1) }} options={[25, 50, 100].map(size => ({ value: String(size), label: String(size) }))} /><Select label="Filter this page" value={filter} onValueChange={setFilter} options={[{ value: 'all', label: 'All visits' }, { value: 'open', label: 'No recorded exit' }, { value: 'closed', label: 'Recorded exit' }]} /></div>}>
    <DataBoundary pending={result.isPending} error={result.error} hasData={result.data !== undefined} retry={() => { void result.refetch() }}>
      {!result.data?.records ? <EmptyState heading="Visit records unavailable">The response did not include a record list.</EmptyState> : rows.length ? <TableFrame label="Crowd entry and exit records"><table className="ui-table entries-table"><caption className="sr-only">Visit records in site timezone {timezone}</caption><thead><tr><th scope="col">Name</th><th scope="col">Gender</th><th scope="col">Entry</th><th scope="col">Exit</th><th scope="col">Dwell time</th></tr></thead><tbody>{rows.map((record, index) => <tr key={`${record.personId ?? record.personName}-${record.entryUtc}-${record.zoneId}-${index}`}><th scope="row"><div className="visitor-name"><span className="visitor-avatar"><UserRound size={17} aria-hidden="true" /></span><span>{record.personName || 'Unnamed visitor'}{record.zoneName && <small>{record.zoneName}</small>}</span></div></th><td className="gender-cell">{record.gender || 'Unavailable'}</td><td>{formatTime(record.entryUtc, timezone, true)}</td><td>{record.exitUtc === null ? <span className="open-visit">No recorded exit</span> : formatTime(record.exitUtc, timezone, true)}</td><td>{record.dwellMinutes === null ? <span className="ui-muted">Not recorded</span> : dwellText(record.dwellMinutes)}</td></tr>)}</tbody></table></TableFrame> : <EmptyState heading={records.length ? 'No matching visits on this page' : 'No visits in this window'}>{records.length ? 'Choose All visits or move to another page. This filter only applies to loaded records.' : 'Try another date window. There are no visit records to display.'}</EmptyState>}
      <div className="entries-pagination"><p className="ui-muted">{number(result.data?.totalRecords)} total records · {rows.length} shown on this page{result.isFetching ? ' · Updating…' : ''}</p>{totalPages !== undefined && page > Math.max(totalPages, 1) ? <div className="app-stack"><p>This page is no longer available.</p><div><Button variant="secondary" onClick={() => setPage(1)}>Return to first page</Button></div></div> : typeof totalPages === 'number' ? <Pagination page={result.data?.pageNumber ?? page} totalPages={totalPages} onChange={next => { setPage(next); setFilter('all') }} /> : <p className="ui-muted">Pagination metadata unavailable.</p>}</div>
      <p className="data-note">Each row is a visit/session, not a unique person. No recorded exit does not prove a person is still inside.</p>
    </DataBoundary>
  </Surface>
}
