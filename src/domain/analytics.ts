import type { OccupancyBucket, DemographicsBucket } from '../api/contracts.ts'
import { formatTime, localDate, percentChange, shiftDate } from './time.ts'
import type { TimeWindow } from './time.ts'

export const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
export function dwellText(value: unknown) {
  if (!finite(value) || value < 0) return 'Unavailable'
  const seconds = Math.round(value * 60)
  return `${Math.floor(seconds / 60)}m ${String(seconds % 60).padStart(2, '0')}s`
}
export function occupancyPoints(buckets: OccupancyBucket[] | undefined, timezone: string) {
  const source = (buckets ?? []).filter((bucket): bucket is OccupancyBucket & { utc: number } => finite(bucket.utc)).sort((a, b) => a.utc - b.utc)
  const points: { label: string; occupancy: number | null }[] = []
  let previous: number | null = null
  for (const bucket of source) {
    if (previous !== null) {
      // Missing hourly observations remain gaps; do not interpolate a count.
      for (let utc = previous + 3_600_000; utc < bucket.utc && points.length < 800; utc += 3_600_000) points.push({ label: formatTime(utc, timezone, true), occupancy: null })
    }
    points.push({ label: formatTime(bucket.utc, timezone, true), occupancy: finite(bucket.avg) ? bucket.avg : null })
    previous = bucket.utc
    if (points.length >= 800) break
  }
  return points
}
export function demographicPoints(buckets: DemographicsBucket[] | undefined, timezone: string) {
  const sorted = (buckets ?? []).filter((bucket): bucket is DemographicsBucket & { utc: number } => finite(bucket.utc)).sort((a, b) => a.utc - b.utc)
  const points: { label: string; male: number | null; female: number | null }[] = []
  let previous: number | null = null
  for (const bucket of sorted) {
    if (previous !== null) for (let utc = previous + 3_600_000; utc < bucket.utc && points.length < 800; utc += 3_600_000) points.push({ label: formatTime(utc, timezone, true), male: null, female: null })
    points.push({ label: formatTime(bucket.utc, timezone, true), male: finite(bucket.male) ? bucket.male : null, female: finite(bucket.female) ? bucket.female : null })
    previous = bucket.utc
    if (points.length >= 800) break
  }
  return { points, buckets: sorted }
}
export function distribution(male: unknown, female: unknown) {
  if (!finite(male) || !finite(female) || male < 0 || female < 0 || male + female === 0) return null
  return { male: male / (male + female) * 100, female: female / (male + female) * 100 }
}

/** Compare two complete UTC-hour averages at matching local calendar times. */
export function compareOccupancyHours(current: OccupancyBucket[] | undefined, previous: OccupancyBucket[] | undefined, range: TimeWindow, timezone: string) {
  const complete = (buckets: OccupancyBucket[] | undefined, from: number, to: number) => (buckets ?? [])
    .filter((bucket): bucket is { utc: number; avg: number } => finite(bucket.utc) && finite(bucket.avg) && bucket.utc >= from && bucket.utc + 3_600_000 <= to)
    .sort((a, b) => a.utc - b.utc)
  const currentHours = complete(current, range.fromUtc, range.toUtc)
  const latest = currentHours.at(-1)
  if (!latest) return null
  const date = localDate(latest.utc, timezone)
  const clock = formatTime(latest.utc, timezone)
  const dayShift = Math.round((Date.parse(`${localDate(range.fromUtc, timezone)}T00:00:00Z`) - Date.parse(`${localDate(range.previous.fromUtc, timezone)}T00:00:00Z`)) / 86_400_000)
  const priorDate = shiftDate(date, -dayShift)
  const priorHours = complete(previous, range.previous.fromUtc, range.previous.toUtc).filter(bucket => localDate(bucket.utc, timezone) === priorDate && formatTime(bucket.utc, timezone) === clock)
  // Repeated local hours at a DST fall-back are ambiguous; do not choose one silently.
  if (priorHours.length !== 1 || currentHours.filter(bucket => localDate(bucket.utc, timezone) === date && formatTime(bucket.utc, timezone) === clock).length !== 1) return null
  const prior = priorHours[0]
  return { current: latest.avg, previous: prior.avg, currentUtc: latest.utc, previousUtc: prior.utc, change: percentChange(latest.avg, prior.avg) }
}
