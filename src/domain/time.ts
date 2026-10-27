export type RangeMode = 'today' | 'yesterday' | 'custom'
export interface DateSelection { mode: RangeMode; from: string; to: string }
export interface TimeWindow { fromUtc: number; toUtc: number; previous: { fromUtc: number; toUtc: number }; label: string; isToday: boolean }
const formatters = new Map<string, Intl.DateTimeFormat>()
export function validTimezone(zone: unknown): zone is string {
  if (typeof zone !== 'string' || !zone) return false
  try { new Intl.DateTimeFormat('en', { timeZone: zone }).format(0); return true } catch { return false }
}
export function localDate(utc: number, timezone: string): string {
  let formatter = formatters.get(timezone)
  if (!formatter) { formatter = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }); formatters.set(timezone, formatter) }
  const parts = formatter.formatToParts(utc)
  const part = (name: string) => parts.find(value => value.type === name)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}
function dateUtc(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error('Select valid start and end dates.')
  const utc = Date.parse(`${date}T00:00:00Z`)
  if (!Number.isFinite(utc) || new Date(utc).toISOString().slice(0, 10) !== date) throw new Error('Select valid start and end dates.')
  return utc
}
export function shiftDate(date: string, days: number) { return new Date(dateUtc(date) + days * 86_400_000).toISOString().slice(0, 10) }
/** Earliest real instant of the local day, including 23/25-hour DST days. */
export function dayStart(date: string, timezone: string) {
  const anchor = dateUtc(date)
  let low = anchor - 36 * 3_600_000, high = anchor + 36 * 3_600_000
  while (low < high) {
    const mid = Math.floor((low + high) / 2)
    if (localDate(mid, timezone) < date) low = mid + 1
    else high = mid
  }
  if (localDate(low, timezone) !== date) throw new Error('That local date does not exist in this timezone.')
  return low
}
export function buildWindow(selection: DateSelection, timezone: string, now: number): TimeWindow {
  const today = localDate(now, timezone)
  const start = selection.mode === 'custom' ? selection.from : selection.mode === 'today' ? today : shiftDate(today, -1)
  const end = selection.mode === 'custom' ? selection.to : start
  const days = (dateUtc(end) - dateUtc(start)) / 86_400_000 + 1
  if (days < 1 || days > 31) throw new Error('Choose an ordered range of up to 31 days.')
  if (end > today) throw new Error('Choose dates up to today in the site timezone.')
  const fromUtc = dayStart(start, timezone)
  const toUtc = Math.min(dayStart(shiftDate(end, 1), timezone) - 1, now)
  if (toUtc <= fromUtc) throw new Error('This time window has not started yet.')
  const previousFrom = dayStart(shiftDate(start, -days), timezone)
  const previousTo = toUtc === now
    ? Math.min(fromUtc - 1, previousFrom + toUtc - fromUtc)
    : fromUtc - 1
  return { fromUtc, toUtc, previous: { fromUtc: previousFrom, toUtc: previousTo }, label: start === end ? start : `${start} – ${end}`, isToday: start === today && end === today }
}
export function formatTime(utc: unknown, timezone: string, withDate = false) {
  if (typeof utc !== 'number' || !Number.isFinite(utc) || Math.abs(utc) > 8_640_000_000_000_000) return 'Unavailable'
  return new Intl.DateTimeFormat('en-GB', { timeZone: timezone, ...(withDate ? { day: '2-digit', month: 'short' } : {}), hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(utc)
}
export const number = (value: unknown, decimals = 0) => typeof value === 'number' && Number.isFinite(value)
  ? new Intl.NumberFormat('en', { maximumFractionDigits: decimals }).format(value) : 'Unavailable'
export function percentChange(current: unknown, previous: unknown): number | null {
  return typeof current === 'number' && typeof previous === 'number' && Number.isFinite(current) && Number.isFinite(previous) && previous > 0
    ? (current - previous) / previous * 100 : null
}
