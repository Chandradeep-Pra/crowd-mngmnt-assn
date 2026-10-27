import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import {
  apiContracts,
  analyticsPeriodRequestSchema,
  createUserRequestSchema,
  demographicsResponseSchema,
  dwellResponseSchema,
  entryExitRequestSchema,
  entryExitResponseSchema,
  footfallResponseSchema,
  loginRequestSchema,
  loginResponseSchema,
  occupancyRequestSchema,
  occupancyResponseSchema,
  siteIdPathSchema,
  sitesResponseSchema,
} from '../src/api/contracts.ts'

const period = { siteId: '<site-id>', fromUtc: 0, toUtc: 3_600_000 }

test('analytics requirements differ by operation in the supplied specification', () => {
  assert.equal(analyticsPeriodRequestSchema.safeParse(period).success, true)
  for (const key of Object.keys(period)) {
    const incomplete = { ...period }
    delete incomplete[key]
    assert.equal(analyticsPeriodRequestSchema.safeParse(incomplete).success, false)
  }
  assert.equal(analyticsPeriodRequestSchema.safeParse({ ...period, fromUtc: '0' }).success, false)
  assert.equal(occupancyRequestSchema.safeParse({}).success, true)
  assert.equal(occupancyRequestSchema.safeParse(undefined).success, false)
  assert.equal(loginRequestSchema.safeParse({}).success, true)
})

test('dwellRecords is numeric; missing and nullable fields are not interchangeable', () => {
  assert.equal(dwellResponseSchema.safeParse({ ...period, avgDwellMinutes: 12.34, dwellRecords: 2 }).success, true)
  assert.equal(dwellResponseSchema.safeParse({ ...period, dwellRecords: [] }).success, false)
  assert.equal(dwellResponseSchema.safeParse({ avgDwellMinutes: null }).success, false)
  assert.equal(dwellResponseSchema.safeParse({}).success, true)
  assert.equal(footfallResponseSchema.safeParse({ footfall: 0 }).success, true)
  assert.equal(footfallResponseSchema.safeParse({ footfall: null }).success, false)
})

test('user-confirmed login response requires the token wrapper rather than guessing alternate field names', () => {
  assert.equal(loginResponseSchema.safeParse({ token: 'synthetic-value' }).success, true)
  for (const payload of [{}, { accessToken: 'synthetic-value' }, { token: '' }, { token: null }, 'synthetic-value']) {
    assert.equal(loginResponseSchema.safeParse(payload).success, false)
  }
  assert.equal(apiContracts.login.responses[200], loginResponseSchema)
})

test('entry-exit permits explicitly nullable exits and dwell without inventing entry nullability', () => {
  const response = {
    totalRecords: 1, totalPages: 1, pageNumber: 1, pageSize: 50,
    records: [{ entryUtc: 0, exitUtc: null, exitLocal: null, dwellMinutes: null }],
  }
  assert.equal(entryExitResponseSchema.safeParse(response).success, true)
  assert.equal(entryExitResponseSchema.safeParse({ records: [] }).success, true)
  assert.equal(entryExitResponseSchema.safeParse({ records: [{ entryUtc: null }] }).success, false)
  assert.equal(entryExitResponseSchema.safeParse({ records: [{ dwellMinutes: '2' }] }).success, false)
})

test('observed empty analytics preserve zero values and distinguish no dwell records from a measured duration', async () => {
  const footfall = footfallResponseSchema.parse(JSON.parse(await readFile(new URL('./fixtures/footfall-empty-response.json', import.meta.url), 'utf8')))
  const dwell = dwellResponseSchema.parse(JSON.parse(await readFile(new URL('./fixtures/dwell-empty-response.json', import.meta.url), 'utf8')))
  assert.equal(footfall.footfall, 0)
  assert.equal(dwell.avgDwellMinutes, 0)
  assert.equal(dwell.dwellRecords, 0)
  assert.equal(footfall.fromUtc, dwell.fromUtc)
  assert.equal(footfall.toUtc, dwell.toUtc)
  assert.equal(footfall.toUtc - footfall.fromUtc, 3_600_000)
  assert.equal(footfallResponseSchema.safeParse({ footfall: null }).success, false)
  assert.equal(dwellResponseSchema.safeParse({ dwellRecords: null }).success, false)
})

test('page defaults are metadata, not client mutations or invented numeric constraints', () => {
  assert.deepEqual(entryExitRequestSchema.parse({}), {})
  assert.deepEqual(apiContracts.entryExit.documentedDefaults, { pageSize: 50, pageNumber: 1 })
  // Swagger uses number and supplies no integer/minimum or range-order constraints.
  assert.equal(entryExitRequestSchema.safeParse({ pageSize: 2.5 }).success, true)
  assert.equal(analyticsPeriodRequestSchema.safeParse({ ...period, fromUtc: 10, toUtc: 0 }).success, true)
})

test('observed entry-exit preserves paging, gender and open sessions and exposes the local-label mismatch', async () => {
  const example = JSON.parse(await readFile(new URL('./fixtures/entry-exit-response.json', import.meta.url), 'utf8'))
  const parsed = entryExitResponseSchema.parse(example)
  assert.equal(parsed.fromUtc, 1793037600000)
  assert.equal(parsed.toUtc, 1793041200000)
  assert.equal(parsed.pageNumber, 1)
  assert.equal(parsed.records.length, parsed.pageSize)
  assert.equal(parsed.totalPages, Math.ceil(parsed.totalRecords / parsed.pageSize))
  const record = parsed.records[0]
  assert.equal(record.gender, 'male')
  assert.equal(record.exitUtc, null)
  assert.equal(record.exitLocal, null)
  assert.equal(record.dwellMinutes, null)
  assert.equal(new Date(record.entryUtc).toISOString(), '2026-10-26T18:59:39.119Z')
  const local = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).format(record.entryUtc).replace(',', '')
  assert.equal(local, '27/10/2026 00:29:39')
  assert.notEqual(record.entryLocal, local)
  assert.equal(entryExitResponseSchema.safeParse({ records: [{ gender: 1 }] }).success, false)
  assert.equal(entryExitResponseSchema.safeParse({ fromUtc: '0' }).success, false)
  assert.equal(apiContracts.entryExit.responseModelSource, 'swagger-and-user-shared-example')
})

test('the sanitized sites example validates without enforcing UUIDs or inventing congestion levels', async () => {
  const example = JSON.parse(await readFile(new URL('./fixtures/sites-response.json', import.meta.url), 'utf8'))
  assert.equal(sitesResponseSchema.safeParse(example).success, true)
  assert.equal(sitesResponseSchema.safeParse([]).success, true)
  assert.equal(sitesResponseSchema.safeParse([{}]).success, true)
  assert.equal(sitesResponseSchema.safeParse([{ zones: [{ securityLevel: 'critical' }] }]).success, false)
  assert.equal(sitesResponseSchema.safeParse([{ timezone: null }]).success, false)
  assert.equal(siteIdPathSchema.safeParse({}).success, false)
  assert.equal(siteIdPathSchema.safeParse({ id: '<site-id>' }).success, true)
})

test('observed last page has completed sessions with millisecond durations, two-decimal dwell and UTC-formatted local labels', async () => {
  const example = JSON.parse(await readFile(new URL('./fixtures/entry-exit-last-page-response.json', import.meta.url), 'utf8'))
  const parsed = entryExitResponseSchema.parse(example)
  assert.equal(parsed.pageNumber, parsed.totalPages)
  assert.equal(parsed.totalPages, Math.ceil(parsed.totalRecords / parsed.pageSize))
  assert.equal(parsed.records.length, 2)
  const utcFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'UTC', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  })
  for (const record of parsed.records) {
    assert.equal(typeof record.exitUtc, 'number')
    assert.ok(record.entryUtc >= parsed.fromUtc && record.entryUtc < parsed.toUtc)
    assert.ok(record.exitUtc > record.entryUtc && record.exitUtc < parsed.toUtc)
    const minutes = (record.exitUtc - record.entryUtc) / 60_000
    assert.equal(record.dwellMinutes, Math.round(minutes * 100) / 100)
    assert.equal(record.entryLocal, utcFormatter.format(record.entryUtc).replace(',', ''))
    assert.equal(record.exitLocal, utcFormatter.format(record.exitUtc).replace(',', ''))
  }
})

test('unspecified additional properties are preserved for later schema discovery', () => {
  assert.deepEqual(footfallResponseSchema.parse({ footfall: 3, extra: { source: 'example' } }), {
    footfall: 3, extra: { source: 'example' },
  })
})

test('observed occupancy preserves fractional averages, zero and the upper-bound bucket without assuming their meaning', async () => {
  const example = JSON.parse(await readFile(new URL('./fixtures/occupancy-response.json', import.meta.url), 'utf8'))
  const parsed = occupancyResponseSchema.parse(example)
  assert.equal(parsed.timezone, 'Asia/Kolkata')
  assert.equal(parsed.buckets.length, 2)
  assert.equal(parsed.buckets[0].avg, 113.4)
  assert.equal(parsed.buckets[1].avg, 0)
  assert.equal(parsed.buckets[1].utc, parsed.toUtc)
  assert.equal(parsed.buckets[1].local, '27/10/2026 00:30:00')
  for (const bucket of [{ utc: '0' }, { local: 0 }, { avg: '0' }]) {
    assert.equal(occupancyResponseSchema.safeParse({ buckets: [bucket] }).success, false)
  }
  assert.equal(occupancyResponseSchema.safeParse({ buckets: [] }).success, true)
  assert.equal(apiContracts.occupancy.responses[200], occupancyResponseSchema)
  assert.equal(apiContracts.occupancy.responseModelSource, 'user-shared-example')
})

test('create-user request is modeled without granting permission to execute it', () => {
  assert.equal(createUserRequestSchema.safeParse({ name: 'Example', email: 'person@example.invalid' }).success, true)
  assert.equal(createUserRequestSchema.safeParse({ name: 'Example' }).success, false)
  assert.equal(createUserRequestSchema.safeParse({ name: 'Example', email: 'invalid' }).success, false)
  for (const operation of ['createUser', 'startSimulation', 'stopSimulation']) {
    assert.equal(apiContracts[operation].access, 'forbidden')
  }
})

test('observed demographics preserves fractional values and zeros without asserting integer entry counts', async () => {
  const example = JSON.parse(await readFile(new URL('./fixtures/demographics-response.json', import.meta.url), 'utf8'))
  const parsed = demographicsResponseSchema.parse(example)
  assert.equal(parsed.timezone, 'Asia/Kolkata')
  assert.equal(parsed.buckets[0].male, 70.6)
  assert.equal(parsed.buckets[0].female, 42.8)
  assert.equal(parsed.buckets[1].male, 0)
  assert.equal(parsed.buckets[1].female, 0)
  assert.equal(parsed.buckets[1].utc, parsed.toUtc)
  for (const bucket of [{ male: '70.6' }, { female: '42.8' }]) {
    assert.equal(demographicsResponseSchema.safeParse({ buckets: [bucket] }).success, false)
  }
  assert.equal(apiContracts.demographics.responses[200], demographicsResponseSchema)
  assert.equal(apiContracts.demographics.responseModelSource, 'user-shared-example')
})

test('all 13 documented operations retain method, security source, status codes and response gaps', () => {
  assert.equal(Object.keys(apiContracts).length, 13)
  assert.deepEqual(Object.keys(apiContracts.createUser.responses), ['201', '400', '403', '500'])
  assert.deepEqual(Object.keys(apiContracts.site.responses), ['200', '401', '404'])
  assert.equal(apiContracts.health.auth.source, 'global')
  assert.equal(apiContracts.login.auth.source, 'global')
  assert.equal(apiContracts.sites.auth.source, 'operation')
  for (const operation of ['health', 'secureHealth', 'startSimulation', 'stopSimulation']) {
    assert.equal(apiContracts[operation].responses[200], null)
  }
})
