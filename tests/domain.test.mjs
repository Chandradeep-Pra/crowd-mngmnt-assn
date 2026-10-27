import assert from 'node:assert/strict'
import test from 'node:test'
import { buildWindow, dayStart, formatTime, localDate, percentChange, shiftDate } from '../src/domain/time.ts'
import { compareOccupancyHours, demographicPoints, distribution, dwellText, occupancyPoints } from '../src/domain/analytics.ts'

test('local-day bounds use the site timezone, including fractional offsets and DST', () => {
  assert.equal(new Date(dayStart('2026-10-27', 'Asia/Kolkata')).toISOString(), '2026-10-26T18:30:00.000Z')
  assert.equal(new Date(dayStart('2026-10-27', 'Asia/Dubai')).toISOString(), '2026-10-26T20:00:00.000Z')
  const spring = dayStart('2026-03-09', 'America/Los_Angeles') - dayStart('2026-03-08', 'America/Los_Angeles')
  const autumn = dayStart('2026-11-02', 'America/Los_Angeles') - dayStart('2026-11-01', 'America/Los_Angeles')
  assert.equal(spring, 23 * 3_600_000)
  assert.equal(autumn, 25 * 3_600_000)
})
test('today comparison matches elapsed duration and whole historical days have nonoverlapping bounds', () => {
  const now = Date.parse('2026-10-27T11:34:11.801Z')
  const today = buildWindow({ mode: 'today', from: '', to: '' }, 'Asia/Kolkata', now)
  assert.equal(today.toUtc, now)
  assert.equal(today.toUtc - today.fromUtc, today.previous.toUtc - today.previous.fromUtc)
  const yesterday = buildWindow({ mode: 'yesterday', from: '', to: '' }, 'Asia/Kolkata', now)
  assert.equal(yesterday.toUtc, today.fromUtc - 1)
  assert.equal(yesterday.previous.toUtc, yesterday.fromUtc - 1)
})
test('invalid dates, reversed/future/overlong ranges and skipped calendar days fail explicitly', () => {
  const now = Date.parse('2026-10-27T11:00:00Z')
  for (const [from,to] of [['2026-02-30','2026-03-01'],['2026-10-27','2026-10-26'],['2026-10-27','2026-10-28'],['2026-01-01','2026-10-01']]) assert.throws(() => buildWindow({ mode: 'custom', from, to }, 'UTC', now))
  assert.throws(() => dayStart('2011-12-30', 'Pacific/Apia'))
  assert.equal(shiftDate('2026-03-01', -1), '2026-02-28')
})
test('formatting uses UTC instants rather than inconsistent API local strings', () => {
  const utc = Date.parse('2026-10-26T18:00:00Z')
  assert.equal(localDate(utc, 'Asia/Kolkata'), '2026-10-26')
  assert.equal(formatTime(utc, 'Asia/Kolkata'), '23:30')
  assert.equal(formatTime(null, 'Asia/Kolkata'), 'Unavailable')
})
test('comparisons, dwell rounding and demographic shares preserve missing/zero distinctions', () => {
  assert.equal(percentChange(0, 100), -100)
  assert.equal(percentChange(100, 0), null)
  assert.equal(percentChange(undefined, 100), null)
  assert.equal(dwellText(null), 'Unavailable')
  assert.equal(dwellText(0), '0m 00s')
  assert.equal(dwellText(20.6), '20m 36s')
  assert.equal(distribution(0, 0), null)
  assert.equal(distribution(null, 4), null)
  assert.deepEqual(distribution(0, 5), { male: 0, female: 100 })
})
test('hourly chart gaps stay null and recorded zeros/fractional averages are preserved', () => {
  const points = occupancyPoints([{ utc: 0, avg: 12.4 }, { utc: 7_200_000, avg: 0 }], 'UTC')
  assert.deepEqual(points.map(item => item.occupancy), [12.4, null, 0])
  const demographics = demographicPoints([{ utc: 0, male: 2.5 }, { utc: 7_200_000, male: 0, female: 0 }], 'UTC')
  assert.deepEqual(demographics.points.map(item => item.female), [null, null, 0])
  assert.equal(demographics.buckets.length, 2)
})

test('occupancy compares complete matching hours, omitting partial/boundary buckets', () => {
  const range = buildWindow({ mode: 'today', from: '', to: '' }, 'Asia/Kolkata', Date.parse('2026-10-27T10:20:00Z'))
  const utc = Date.parse('2026-10-27T09:00:00Z'), prior = utc - 86_400_000
  const result = compareOccupancyHours([{ utc, avg: 100 }, { utc: utc + 3_600_000, avg: 7 }], [{ utc: prior, avg: 80 }], range, 'Asia/Kolkata')
  assert.deepEqual(result, { current: 100, previous: 80, currentUtc: utc, previousUtc: prior, change: 25 })
  assert.equal(compareOccupancyHours([{ utc: range.fromUtc - 1, avg: 10 }], [], range, 'Asia/Kolkata'), null)
  assert.equal(compareOccupancyHours([{ utc, avg: 10 }], [], range, 'Asia/Kolkata'), null)
  assert.equal(compareOccupancyHours([{ utc, avg: 0 }], [{ utc: prior, avg: 80 }], range, 'Asia/Kolkata').change, -100)
  assert.equal(compareOccupancyHours([{ utc, avg: 10 }], [{ utc: prior, avg: 0 }], range, 'Asia/Kolkata').change, null)
})

test('occupancy avoids duplicate and repeated DST local-hour comparisons', () => {
  const range = buildWindow({ mode: 'today', from: '', to: '' }, 'America/Los_Angeles', Date.parse('2026-11-01T10:30:00Z'))
  const first = Date.parse('2026-11-01T08:00:00Z'), second = Date.parse('2026-11-01T09:00:00Z')
  const previous = [{ utc: Date.parse('2026-10-31T08:00:00Z'), avg: 80 }]
  assert.equal(compareOccupancyHours([{ utc: first, avg: 100 }, { utc: second, avg: 90 }], previous, range, 'America/Los_Angeles'), null)
  assert.equal(compareOccupancyHours([{ utc: first, avg: 100 }, { utc: first, avg: 100 }], previous, range, 'America/Los_Angeles'), null)
})
