import { z } from 'zod'
const timestamp = z.number().finite().nonnegative().max(8_640_000_000_000_000)

// Minimum fields needed by this UI, not claims about all possible server payloads.
export const liveEventSchema = z.object({
  ts: timestamp, siteId: z.string().min(1), siteOccupancy: z.number().finite().nonnegative(),
  zoneId: z.string().optional(), zoneOccupancy: z.number().finite().nonnegative().optional(),
  genderCount: z.object({ male: z.number().finite().nonnegative(), female: z.number().finite().nonnegative() }).optional(),
})
export const alertEventSchema = z.object({
  ts: timestamp, siteId: z.string().min(1), direction: z.string(),
  eventId: z.string().optional(), personId: z.string().optional(), personName: z.string().optional(),
  zoneId: z.string().optional(), zoneName: z.string().optional(), siteName: z.string().optional(), severity: z.string().optional(),
})
export type LiveEvent = z.infer<typeof liveEventSchema>
export type AlertEvent = z.infer<typeof alertEventSchema>
export type Movement = AlertEvent & { key: string; receivedAt?: number }
