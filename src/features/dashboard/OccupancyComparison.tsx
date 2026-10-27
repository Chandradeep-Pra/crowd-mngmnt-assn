import { Info } from 'lucide-react'
import type { compareOccupancyHours } from '../../domain/analytics.ts'
import { formatTime, number } from '../../domain/time.ts'

export function OccupancyComparison({ comparison, pending, timezone }: { comparison: ReturnType<typeof compareOccupancyHours>; pending: boolean; timezone: string }) {
  if (!comparison) return <span className="hourly-comparison-empty" role="status" aria-label={pending ? 'Loading hourly average comparison' : 'Hourly average comparison unavailable'}>Hourly avg {pending ? '…' : '—'}</span>
  const delta = comparison.change
  return <details className="hourly-comparison"><summary>Hourly avg <strong>{delta === null ? '—' : `${delta > 0 ? '+' : ''}${number(delta, 1)}%`}</strong><Info size={15} aria-hidden="true" /></summary><div><p>Completed hourly averages</p><p>{formatTime(comparison.currentUtc, timezone, true)}: <strong>{number(comparison.current, 2)}</strong></p><p>{formatTime(comparison.previousUtc, timezone, true)}: <strong>{number(comparison.previous, 2)}</strong></p>{delta === null && <p>No non-zero comparison baseline.</p>}</div></details>
}
