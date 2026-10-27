import { useState } from 'react'
import type { CSSProperties } from 'react'
import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight } from 'lucide-react'
import type { Movement } from '../../realtime/contracts.ts'
import { formatTime } from '../../domain/time.ts'
import { StatusBadge } from '../../components/ui/Display.tsx'

export function MovementList({ events, timezone }: { events: readonly Movement[]; timezone: string }) {
  return <ol className="movement-list">{events.map((event, index) => <MovementRow key={event.key} event={event} timezone={timezone} latest={index === 0} />)}</ol>
}

function MovementRow({ event, timezone, latest }: { event: Movement; timezone: string; latest: boolean }) {
  const direction = event.direction === 'entry' || event.direction === 'zone-entry' ? 'entry'
    : event.direction === 'exit' || event.direction === 'zone-exit' ? 'exit' : 'other'
  const label = event.direction === 'zone-entry' ? 'Zone entry' : event.direction === 'zone-exit' ? 'Zone exit'
    : direction === 'entry' ? 'Entry' : direction === 'exit' ? 'Exit' : event.direction || 'Movement'
  // Capture once per keyed row: rerenders and reopening retained events cannot restart a pulse.
  const [elapsed] = useState(() => event.receivedAt === undefined ? 1_800 : Math.max(0, Date.now() - event.receivedAt))
  const Icon = direction === 'entry' ? ArrowDownLeft : direction === 'exit' ? ArrowUpRight : ArrowLeftRight
  return <li className={`movement-row movement-row--${direction}${latest && elapsed < 1_800 ? ' movement-row--new' : ''}`} style={{ '--movement-pulse-delay': `-${elapsed}ms` } as CSSProperties}><span className="movement-icon" aria-hidden="true"><Icon size={19} /></span><div><p className="movement-person"><strong>{event.personName || 'Unnamed visitor'}</strong><span className="movement-direction">{label}</span></p><p className="ui-muted">{event.zoneName || 'Zone unavailable'}</p>{event.severity && <StatusBadge>Severity: {event.severity}</StatusBadge>}</div><time className="movement-time" dateTime={new Date(event.ts).toISOString()}>{formatTime(event.ts, timezone, true)}</time></li>
}
