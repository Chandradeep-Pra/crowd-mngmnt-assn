import { z } from 'zod'


const periodFields = {
  siteId: z.string(),
  fromUtc: z.number(), // UTC epoch milliseconds; no integer/minimum rule documented.
  toUtc: z.number(),
}

export const analyticsPeriodRequestSchema = z.looseObject(periodFields)
export const footfallRequestSchema = analyticsPeriodRequestSchema
export const dwellRequestSchema = analyticsPeriodRequestSchema
export const occupancyRequestSchema = analyticsPeriodRequestSchema.partial()
export const demographicsRequestSchema = analyticsPeriodRequestSchema.partial()
export const entryExitRequestSchema = z.looseObject({
  ...occupancyRequestSchema.shape,
  pageSize: z.number().optional(),
  pageNumber: z.number().optional(),
})

export const loginRequestSchema = z.looseObject({
  email: z.string().optional(),
  password: z.string().optional(),
})

// User-confirmed successful response. Token presence is required by the login flow.
export const loginResponseSchema = z.looseObject({ token: z.string().min(1) })

export const zoneSchema = z.looseObject({
  zoneId: z.string(),
  name: z.string(),
  securityLevel: z.enum(['high', 'medium', 'low']),
}).partial()

export const siteSchema = z.looseObject({
  siteId: z.string(),
  name: z.string(),
  timezone: z.string(),
  country: z.string(),
  city: z.string(),
  zones: z.array(zoneSchema),
}).partial()

export const sitesResponseSchema = z.array(siteSchema)
export const siteIdPathSchema = z.looseObject({ id: z.string() })
export const siteNotFoundResponseSchema = z.looseObject({
  errorMessage: z.string(),
}).partial()

export const footfallResponseSchema = z.looseObject({
  ...periodFields,
  footfall: z.number(), // Entry-event total, not unique people or hourly buckets.
}).partial()

export const dwellResponseSchema = z.looseObject({
  ...periodFields,
  avgDwellMinutes: z.number(), // Server describes rounding to two decimals.
  dwellRecords: z.number(), // Number of dwell events, NOT an array of records.
}).partial()

// Observed in the user's occupancy response, not defined by Swagger.
// Requiredness/nullability remain unverified; this is an observed-shape model.
export const occupancyBucketSchema = z.looseObject({
  utc: z.number(),
  local: z.string(),
  avg: z.number(),
}).partial()

export const occupancyResponseSchema = z.looseObject({
  ...periodFields,
  timezone: z.string(),
  buckets: z.array(occupancyBucketSchema),
}).partial()

// Observed fractional values; Swagger's "counts" description does not establish
// whether these are averages or another aggregation. Preserve source precision.
export const demographicsBucketSchema = z.looseObject({
  utc: z.number(),
  local: z.string(),
  male: z.number(),
  female: z.number(),
}).partial()

export const demographicsResponseSchema = z.looseObject({
  ...periodFields,
  timezone: z.string(),
  buckets: z.array(demographicsBucketSchema),
}).partial()

export const entryExitRecordSchema = z.looseObject({
  personId: z.string(),
  personName: z.string(),
  gender: z.string(), // Present in the user sample; absent from Swagger, no enum established.
  zoneId: z.string(),
  zoneName: z.string(),
  severity: z.string(), // No enum, threshold, or alert mapping documented.
  entryUtc: z.number(), // User sample is consistent with UTC epoch milliseconds.
  entryLocal: z.string(), // Sample shows UTC clock text despite the site's Asia/Kolkata timezone.
  exitUtc: z.number().nullable(), // Closed-session sample is consistent with epoch milliseconds.
  exitLocal: z.string().nullable(), // Closed-session sample also shows UTC clock text.
  dwellMinutes: z.number().nullable(), // Sample matches (exitUtc - entryUtc) / 60_000, rounded to 2 decimals.
}).partial()

export const entryExitResponseSchema = z.looseObject({
  ...periodFields, // User response includes fromUtc/toUtc, omitted by Swagger.
  totalRecords: z.number(),
  totalPages: z.number(),
  pageNumber: z.number(),
  pageSize: z.number(),
  records: z.array(entryExitRecordSchema),
}).partial()

export const createUserRequestSchema = z.looseObject({
  name: z.string(),
  email: z.email(),
})

// null is deliberate: a documented status/description or example alone does not
// establish a response schema. Callers must not treat these as validated data.
const inheritedBearer = { scheme: 'bearerAuth', source: 'global' } as const
const explicitBearer = { scheme: 'bearerAuth', source: 'operation' } as const

export const apiContracts = {
  login: {
    method: 'POST', path: '/api/auth/login', access: 'login',
    auth: inheritedBearer, bodyRequired: true,
    body: loginRequestSchema,
    responses: { 200: loginResponseSchema, 401: null },
    responseModelSource: 'user-confirmed-shape',
    authNote: 'Global bearer security conflicts with the unauthenticated login flow.',
  },
  sites: {
    method: 'GET', path: '/api/sites', access: 'read',
    auth: explicitBearer,
    responses: { 200: sitesResponseSchema, 401: null },
  },
  site: {
    method: 'GET', path: '/api/sites/{id}', access: 'read',
    auth: explicitBearer, pathParameters: siteIdPathSchema,
    responses: { 200: siteSchema, 401: null, 404: siteNotFoundResponseSchema },
  },
  footfall: {
    method: 'POST', path: '/api/analytics/footfall', access: 'read',
    auth: inheritedBearer, bodyRequired: true,
    body: footfallRequestSchema,
    responses: { 200: footfallResponseSchema },
  },
  dwell: {
    method: 'POST', path: '/api/analytics/dwell', access: 'read',
    auth: inheritedBearer, bodyRequired: true,
    body: dwellRequestSchema,
    responses: { 200: dwellResponseSchema },
  },
  occupancy: {
    method: 'POST', path: '/api/analytics/occupancy', access: 'read',
    auth: inheritedBearer, bodyRequired: true,
    body: occupancyRequestSchema,
    responses: { 200: occupancyResponseSchema },
    responseModelSource: 'user-shared-example',
  },
  demographics: {
    method: 'POST', path: '/api/analytics/demographics', access: 'read',
    auth: inheritedBearer, bodyRequired: true,
    body: demographicsRequestSchema,
    responses: { 200: demographicsResponseSchema },
    responseModelSource: 'user-shared-example',
  },
  entryExit: {
    method: 'POST', path: '/api/analytics/entry-exit', access: 'read',
    auth: inheritedBearer, bodyRequired: true,
    body: entryExitRequestSchema,
    documentedDefaults: { pageSize: 50, pageNumber: 1 },
    responses: { 200: entryExitResponseSchema },
    responseModelSource: 'swagger-and-user-shared-example',
  },
  health: {
    method: 'GET', path: '/api/health', access: 'read',
    auth: inheritedBearer,
    responses: { 200: null },
    authNote: 'Summary calls this public, but global bearer security is not overridden.',
  },
  secureHealth: {
    method: 'GET', path: '/api/health/secure', access: 'read',
    auth: explicitBearer,
    responses: { 200: null, 401: null },
  },
  startSimulation: {
    method: 'GET', path: '/api/sim/start', access: 'forbidden',
    auth: explicitBearer,
    responses: { 200: null, 401: null, 409: null },
    responseExamples: { 200: { message: 'Simulation started' } },
  },
  stopSimulation: {
    method: 'GET', path: '/api/sim/stop', access: 'forbidden',
    auth: explicitBearer,
    responses: { 200: null, 401: null, 409: null },
    responseExamples: { 200: { message: 'Simulation stopped' } },
  },
  createUser: {
    method: 'POST', path: '/api/user/create', access: 'forbidden',
    auth: explicitBearer, bodyRequired: true, role: 'admin',
    body: createUserRequestSchema,
    responses: { 201: null, 400: null, 403: null, 500: null },
    responseExamples: {
      201: { message: 'User created successfully' },
      403: { errorMessage: 'You are not allowed to create user' },
    },
  },
} as const

export type AnalyticsPeriodRequest = z.infer<typeof analyticsPeriodRequestSchema>
export type FootfallRequest = z.infer<typeof footfallRequestSchema>
export type FootfallResponse = z.infer<typeof footfallResponseSchema>
export type DwellRequest = z.infer<typeof dwellRequestSchema>
export type DwellResponse = z.infer<typeof dwellResponseSchema>
export type OccupancyRequest = z.infer<typeof occupancyRequestSchema>
export type OccupancyBucket = z.infer<typeof occupancyBucketSchema>
export type OccupancyResponse = z.infer<typeof occupancyResponseSchema>
export type DemographicsRequest = z.infer<typeof demographicsRequestSchema>
export type DemographicsBucket = z.infer<typeof demographicsBucketSchema>
export type DemographicsResponse = z.infer<typeof demographicsResponseSchema>
export type EntryExitRequest = z.infer<typeof entryExitRequestSchema>
export type EntryExitRecord = z.infer<typeof entryExitRecordSchema>
export type EntryExitResponse = z.infer<typeof entryExitResponseSchema>
export type LoginRequest = z.infer<typeof loginRequestSchema>
export type LoginResponse = z.infer<typeof loginResponseSchema>
export type Zone = z.infer<typeof zoneSchema>
export type Site = z.infer<typeof siteSchema>
export type SitesResponse = z.infer<typeof sitesResponseSchema>
export type SiteIdPath = z.infer<typeof siteIdPathSchema>
export type SiteNotFoundResponse = z.infer<typeof siteNotFoundResponseSchema>
export type CreateUserRequest = z.infer<typeof createUserRequestSchema>

// Missing Swagger response schemas stay unknown, not invented object shapes.
export type HealthResponse = unknown
export type SecureHealthResponse = unknown
export type StartSimulationResponse = unknown
export type StopSimulationResponse = unknown
export type CreateUserResponse = unknown

export type ApiOperation = keyof typeof apiContracts
