import { Select } from '../../components/ui/Select.tsx'
import { useState } from 'react'
import type { FormEvent } from 'react'
import { CalendarDays, RefreshCw } from 'lucide-react'
import { Button, TextField } from '../../components/ui/Controls.tsx'
import { buildWindow, localDate } from '../../domain/time.ts'
import type { DateSelection, TimeWindow } from '../../domain/time.ts'

export function RangeFilters({ timezone, onApply, onRefresh, busy, page }: { timezone: string; onApply: (selection: DateSelection, range: TimeWindow) => void; onRefresh: () => void; busy: boolean; page: string }) {
  const [mode, setMode] = useState<DateSelection['mode']>('today')
  const [from, setFrom] = useState(() => localDate(Date.now(), timezone))
  const [to, setTo] = useState(() => localDate(Date.now(), timezone))
  const [error, setError] = useState('')
  function apply(event: FormEvent) {
    event.preventDefault()
    try { const selection = { mode, from, to }; onApply(selection, buildWindow(selection, timezone, Date.now())); setError('') }
    catch (failure) { setError(failure instanceof Error ? failure.message : 'Select a valid time range.') }
  }
  return <div className="page-toolbar"><div><p className="page-eyebrow">CROWD MANAGEMENT</p><h1>{page}</h1><p className="ui-muted site-timezone">Site timezone · {timezone}</p></div><form className="range-filters" onSubmit={apply}><Select label="Period" value={mode} onValueChange={value => setMode(value as DateSelection['mode'])} options={[{ value: 'today', label: 'Today' }, { value: 'yesterday', label: 'Yesterday' }, { value: 'custom', label: 'Custom dates' }]} />{mode === 'custom' && <><TextField label="From" type="date" value={from} onChange={event => setFrom(event.target.value)} required /><TextField label="Through" type="date" value={to} onChange={event => setTo(event.target.value)} required /></>}<Button type="submit" variant="secondary" icon={<CalendarDays size={17} aria-hidden="true" />}>Apply</Button><Button variant="ghost" icon={<RefreshCw size={18} aria-hidden="true" />} onClick={onRefresh} disabled={busy}>{busy ? 'Updating…' : 'Refresh'}</Button>{error && <p className="range-error" role="alert">{error}</p>}</form></div>
}
