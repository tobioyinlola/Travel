import { z } from 'zod';

const money = z.object({ amountMinor: z.string(), currency: z.string() });
const date = z.iso.date();
const mode = z.enum(['pay_at_hotel', 'prepay', 'deposit']);
const status = z.enum([
  'draft',
  'pending',
  'confirmed',
  'failed',
  'modified',
  'cancelled',
  'completed',
  'reversed',
]);
const lineStatus = z.enum(['pending', 'confirmed', 'failed', 'cancelled']);
const paymentState = z.enum([
  'none',
  'awaiting',
  'captured',
  'failed',
  'partially_refunded',
  'refunded',
]);

export const travelerSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.email().max(200),
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+()\-. ]{6,30}$/)
    .nullable()
    .optional(),
  specialRequests: z.string().trim().max(500).nullable().optional(),
});

export const confirmSchema = z.object({ traveler: travelerSchema, paymentMode: mode });

const travelerView = z.object({
  name: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  specialRequests: z.string().nullable(),
});

const checkoutLine = z.object({
  id: z.uuid(),
  propertyName: z.string(),
  city: z.string(),
  checkIn: date,
  checkOut: date,
  nights: z.number().int(),
  roomName: z.string(),
  board: z.string(),
  total: money,
  feesAtHotel: money,
  refundable: z.boolean(),
  freeCancellationUntil: z.iso.datetime().nullable(),
  cancellationPolicy: z.string(),
  status: lineStatus,
  confirmationCode: z.string().nullable(),
});

/** What the traveler sees at checkout: no suppliers, rate keys or commission. */
export const checkoutSchema = z.object({
  status,
  title: z.string(),
  currency: z.string(),
  total: money,
  lines: z.array(checkoutLine),
  paymentOptions: z.array(z.object({ mode, dueNow: money })),
  selected: z.object({ mode, dueNow: money }).nullable(),
  traveler: travelerView.nullable(),
  payment: z.object({
    state: paymentState,
    amount: money.nullable(),
    /** Hosted-fields token for the payment provider; null until the provider has created the payment. */
    clientToken: z.string().nullable(),
    expiresAt: z.iso.datetime().nullable(),
    failure: z.string().nullable(),
  }),
  failureReason: z.string().nullable(),
  linkExpiresAt: z.iso.datetime(),
});

const advisorLine = checkoutLine.extend({
  supplier: z.string(),
  commissionable: money,
  commissionBps: z.number().int(),
  penalty: money,
  attempts: z.number().int(),
  failureReason: z.string().nullable(),
  guestDetailsSent: z.boolean(),
  guestDetailsRefused: z.boolean(),
});

export const bookingSchema = z.object({
  id: z.uuid(),
  tripId: z.uuid(),
  proposalId: z.uuid(),
  tripTitle: z.string(),
  status,
  /** A cancellation is in progress: suppliers are being asked, the refund follows. */
  cancelling: z.boolean(),
  /** A guest change is being passed to the hotels. */
  modifying: z.boolean(),
  currency: z.string(),
  paymentMode: mode.nullable(),
  total: money,
  dueNow: money,
  paid: money,
  refunded: money,
  penalty: money,
  paymentState: paymentState,
  traveler: travelerView.nullable(),
  lines: z.array(advisorLine),
  failureReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
  confirmedAt: z.iso.datetime().nullable(),
  cancelledAt: z.iso.datetime().nullable(),
});

export const bookingListSchema = z.object({ items: z.array(bookingSchema) });

export const cancellationQuoteSchema = z.object({
  bookingId: z.uuid(),
  /** An estimate from the stated rate terms; suppliers confirm the actual penalty when they cancel. */
  estimate: z.literal(true),
  lines: z.array(
    z.object({
      id: z.uuid(),
      propertyName: z.string(),
      total: money,
      penalty: money,
      freeCancellationUntil: z.iso.datetime().nullable(),
      cancellationPolicy: z.string(),
    }),
  ),
  penalty: money,
  paid: money,
  refund: money,
});

export const cancelSchema = z.object({ reason: z.string().trim().min(2).max(300) });

export const stuckBookingSchema = z.object({
  id: z.uuid(),
  tripTitle: z.string(),
  pendingSince: z.iso.datetime(),
  lines: z.array(
    z.object({
      id: z.uuid(),
      propertyName: z.string(),
      supplier: z.string(),
      status: lineStatus,
      attempts: z.number().int(),
    }),
  ),
});
export const stuckListSchema = z.object({ items: z.array(stuckBookingSchema) });

export const modifySchema = travelerSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Change at least one field' });
