import { z } from 'zod';
import { propertySchema, preferredSchema, rateSchema } from '../../catalog/index.js';

const money = z.object({ amountMinor: z.string(), currency: z.string() });
const date = z.iso.date();
const minor = z.string().regex(/^\d{1,12}$/);

export const tripCreateSchema = z.object({
  clientId: z.uuid(),
  title: z.string().trim().min(2).max(150),
  startDate: date,
  endDate: date,
  adults: z.number().int().min(1).max(12),
  childrenAges: z.array(z.number().int().min(0).max(17)).max(8).default([]),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default('USD'),
  planningFeeMinor: minor.optional(),
  notes: z.string().max(5000).optional(),
});
export const tripUpdateSchema = tripCreateSchema
  .omit({ clientId: true, currency: true })
  .partial()
  .extend({ version: z.number().int().positive() });
export const itemCreateSchema = z.object({
  kind: z.enum(['activity', 'transfer', 'note']),
  day: date,
  title: z.string().trim().min(1).max(150),
  details: z.string().max(5000).optional(),
  startTime: z
    .string()
    .regex(/^([01]\d|2[0-3]):[0-5]\d$/)
    .nullable()
    .optional(),
  location: z.string().max(300).nullable().optional(),
  priceMinor: minor.nullable().optional(),
});
export const itemUpdateSchema = itemCreateSchema
  .omit({ kind: true })
  .partial()
  .extend({ position: z.number().int().min(1).optional() });
export const addHotelSchema = z.object({ rateKey: z.string().min(3).max(4000) });
export const publishSchema = z.object({ sendEmail: z.boolean().default(false) });

const hotelSnapshot = z.object({
  rate: rateSchema,
  property: propertySchema,
  preferred: preferredSchema.nullable(),
});
const item = z.object({
  id: z.uuid(),
  kind: z.enum(['hotel', 'activity', 'transfer', 'note']),
  day: date,
  position: z.number(),
  title: z.string(),
  details: z.string(),
  startTime: z.string().nullable(),
  location: z.string().nullable(),
  price: z.string().nullable(),
  hotel: hotelSnapshot.nullable(),
});
const totals = z.object({
  currency: z.string(),
  lines: z.array(z.object({ itemId: z.string(), label: z.string(), amount: money })),
  taxesIncluded: money,
  planningFee: money,
  total: money,
  payableAtProperty: money,
});
export const proposalSummarySchema = z.object({
  id: z.uuid(),
  version: z.number(),
  status: z.enum(['published', 'approved', 'changes_requested', 'declined', 'superseded']),
  total: money,
  url: z.string().nullable(),
  publishedAt: z.string(),
  ratesCheckedAt: z.string(),
  ratesExpireAt: z.string(),
  linkExpiresAt: z.string(),
  firstViewedAt: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decidedByName: z.string().nullable(),
  decisionNote: z.string().nullable(),
});
export const tripSchema = z.object({
  id: z.uuid(),
  clientId: z.uuid(),
  clientName: z.string(),
  clientEmail: z.string().nullable(),
  title: z.string(),
  startDate: date,
  endDate: date,
  adults: z.number(),
  childrenAges: z.array(z.number()),
  currency: z.string(),
  planningFee: money,
  notes: z.string(),
  status: z.enum(['planning', 'proposed', 'approved', 'booked', 'cancelled']),
  version: z.number(),
  items: z.array(item),
  totals,
  proposals: z.array(proposalSummarySchema),
});
const tripRow = z.object({
  id: z.uuid(),
  clientId: z.uuid(),
  clientName: z.string(),
  title: z.string(),
  startDate: date,
  endDate: date,
  nights: z.number(),
  travelers: z.number(),
  status: z.enum(['planning', 'proposed', 'approved', 'booked', 'cancelled']),
  currency: z.string(),
  destination: z.object({ city: z.string(), countryCode: z.string() }).nullable(),
  total: money,
  itemCount: z.number(),
});
export const tripListSchema = z.array(tripRow);
export const tripSummarySchema = z.object({
  counts: z.object({
    total: z.number(),
    planning: z.number(),
    proposed: z.number(),
    approved: z.number(),
    booked: z.number(),
    upcoming: z.number(),
    travelingNow: z.number(),
  }),
  clients: z.number(),
  pipelineValue: money,
  approvedValue: money,
  proposalsLast7Days: z.array(z.object({ day: date, proposals: z.number() })),
  destinations: z.array(
    z.object({
      countryCode: z.string(),
      city: z.string(),
      trips: z.number(),
      travelers: z.number(),
    }),
  ),
  upcoming: z.array(tripRow),
});
export const publishResultSchema = z.object({
  proposal: proposalSummarySchema,
  priceChanges: z.array(
    z.object({ itemId: z.string(), title: z.string(), before: z.string(), after: z.string() }),
  ),
  republished: z.boolean().optional(),
});

// ---- Traveler link ----
const travelerHotel = z.object({
  name: z.string(),
  address: z.string(),
  starRating: z.number(),
  photo: z.string().nullable(),
  amenities: z.array(z.string()),
  checkIn: date,
  checkOut: date,
  nights: z.number(),
  roomName: z.string(),
  board: z.string(),
  refundable: z.boolean(),
  cancellationPolicy: z.string(),
  total: money,
  taxes: money,
  feesAtHotel: money,
  perks: z.array(z.object({ kind: z.string(), description: z.string() })),
});
export const travelerProposalSchema = z.object({
  version: z.number(),
  status: z.enum(['published', 'approved', 'changes_requested', 'declined', 'superseded']),
  title: z.string(),
  startDate: date,
  endDate: date,
  travelers: z.object({ adults: z.number(), childrenAges: z.array(z.number()) }),
  clientFirstName: z.string(),
  advisorName: z.string(),
  items: z.array(
    z.object({
      id: z.string(),
      kind: z.enum(['hotel', 'activity', 'transfer', 'note']),
      day: date,
      title: z.string(),
      details: z.string(),
      startTime: z.string().nullable(),
      location: z.string().nullable(),
      price: money.nullable(),
      hotel: travelerHotel.nullable(),
    }),
  ),
  totals,
  ratesCheckedAt: z.string(),
  ratesExpireAt: z.string(),
  ratesExpired: z.boolean(),
  decidedAt: z.string().nullable(),
  decidedByName: z.string().nullable(),
  decisionNote: z.string().nullable(),
});
export const decisionSchema = z
  .object({
    decision: z.enum(['approve', 'request_changes', 'decline']),
    name: z.string().trim().min(2).max(120),
    note: z.string().trim().max(2000).optional(),
  })
  .refine((v) => v.decision !== 'request_changes' || (v.note && v.note.length > 0), {
    message: 'Tell your advisor what to change',
    path: ['note'],
  });

// ---------- Trip message thread (FR-TRV-06) ----------
export const messageSchema = z.object({
  id: z.uuid(),
  sender: z.enum(['traveler', 'advisor']),
  senderName: z.string(),
  body: z.string(),
  createdAt: z.iso.datetime(),
  read: z.boolean(),
});
export const messageListSchema = z.object({
  items: z.array(messageSchema),
  unread: z.number().int(),
});
export const travelerMessageSchema = z.object({
  name: z.string().trim().min(2).max(120),
  body: z.string().trim().min(1).max(4000),
});
export const advisorMessageSchema = z.object({ body: z.string().trim().min(1).max(4000) });
