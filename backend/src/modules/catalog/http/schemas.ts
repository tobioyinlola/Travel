import { z } from 'zod';

const money = z.object({ amountMinor: z.string(), currency: z.string() });
const date = z.iso.date();

export const searchQuerySchema = z
  .object({
    destination: z.string().min(1),
    checkIn: date,
    checkOut: date,
    adults: z.coerce.number().int().min(1).max(6),
    childrenAges: z
      .string()
      .regex(/^(\d{1,2})(,\d{1,2})*$/)
      .transform((s) => s.split(',').map(Number))
      .optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .default('USD'),
    maxNightly: z.string().regex(/^\d+$/).optional(),
    minStars: z.coerce.number().int().min(1).max(5).optional(),
    brand: z.string().max(80).optional(),
    amenities: z
      .string()
      .regex(/^[a-z_]+(,[a-z_]+)*$/)
      .transform((s) => s.split(','))
      .optional(),
    preferredOnly: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
    sort: z.enum(['recommended', 'price', 'stars']).default('recommended'),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .refine((v) => v.checkOut > v.checkIn, {
    message: 'Check-out must be after check-in',
    path: ['checkOut'],
  });

const perk = z.object({ kind: z.string(), description: z.string() });
export const preferredSchema = z.object({
  programId: z.uuid(),
  programName: z.string(),
  tier: z.string(),
  perks: z.array(perk),
  rateCodes: z.array(z.string()),
});
export const rateSchema = z.object({
  rateKey: z.string(),
  supplier: z.string(),
  propertyId: z.uuid(),
  checkIn: date,
  checkOut: date,
  nights: z.number(),
  occupancy: z.object({ adults: z.number(), childrenAges: z.array(z.number()) }),
  roomName: z.string(),
  maxOccupancy: z.number(),
  board: z.enum(['room_only', 'breakfast', 'half_board', 'all_inclusive']),
  refundable: z.boolean(),
  freeCancellationUntil: z.string().nullable(),
  cancellationPolicy: z.string(),
  total: money,
  taxes: money,
  feesAtHotel: money,
  commissionable: money,
  commissionBps: z.number(),
  paymentModes: z.array(z.enum(['pay_at_hotel', 'prepay', 'deposit'])),
  rateCodes: z.array(z.string()),
  nightlyAverage: money,
  partnerEligible: z.boolean(),
  checkedAt: z.string(),
});
export const propertySchema = z.object({
  id: z.uuid(),
  name: z.string(),
  brand: z.string().nullable(),
  starRating: z.number(),
  address: z.string(),
  city: z.string(),
  countryCode: z.string(),
  lat: z.number(),
  lng: z.number(),
  amenities: z.array(z.string()),
  description: z.string(),
  photos: z.array(z.string()),
});
export const searchResponseSchema = z.object({
  destination: z.object({ slug: z.string(), name: z.string() }),
  checkIn: date,
  checkOut: date,
  nights: z.number(),
  occupancy: z.object({ adults: z.number(), childrenAges: z.array(z.number()) }),
  currency: z.string(),
  results: z.array(
    z.object({
      property: propertySchema,
      preferred: preferredSchema.nullable(),
      fromNightly: money,
      rates: z.array(rateSchema),
    }),
  ),
  warnings: z.array(z.object({ supplier: z.string(), reason: z.string() })),
  tookMs: z.number(),
});
export const checkRateSchema = z.object({
  rateKey: z.string().min(3).max(4000),
  currency: z.string().regex(/^[A-Z]{3}$/),
});
export const checkRateResponseSchema = z.object({
  available: z.boolean(),
  rate: rateSchema.nullable(),
  property: propertySchema.nullable(),
  preferred: preferredSchema.nullable(),
});
