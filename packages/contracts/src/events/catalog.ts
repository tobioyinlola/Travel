import { z } from 'zod';

const id = z.uuid();
const money = z.object({
  amountMinor: z.string().regex(/^-?\d+$/),
  currency: z.string().length(3),
});

/**
 * Core event catalog from ARCH ("Event catalog (core events)").
 * Key format: `<EventType>.v<version>`. Payloads carry identifiers, never another module's full state.
 * Adding a field is a new minor change in the same version only if optional; anything else is a new version.
 */
export const eventCatalog = {
  'AdvisorApproved.v1': {
    producer: 'identity',
    payload: z.object({ advisorId: id, userId: id }),
  },
  'TierChanged.v1': {
    producer: 'membership',
    payload: z.object({
      advisorId: id,
      fromTier: z.string(),
      toTier: z.string(),
      effectiveAt: z.iso.datetime(),
    }),
  },
  'ProposalPublished.v1': {
    producer: 'itineraries',
    payload: z.object({ proposalId: id, tripId: id, advisorId: id }),
  },
  'ProposalApproved.v1': {
    producer: 'itineraries',
    payload: z.object({
      proposalId: id,
      proposalVersion: z.number().int(),
      tripId: id,
      advisorId: id,
    }),
  },
  'PaymentCaptured.v1': {
    producer: 'commission-payments',
    payload: z.object({ paymentId: id, proposalId: id, amount: money }),
  },
  'BookingConfirmed.v1': {
    producer: 'booking',
    payload: z.object({ bookingId: id, tripId: id, advisorId: id, supplierId: id }),
  },
  'BookingFailed.v1': {
    producer: 'booking',
    payload: z.object({ bookingId: id, tripId: id, advisorId: id, reason: z.string() }),
  },
  'BookingCancelled.v1': {
    producer: 'booking',
    payload: z.object({ bookingId: id, advisorId: id }),
  },
  'BookingCompleted.v1': {
    producer: 'booking',
    payload: z.object({ bookingId: id, advisorId: id }),
  },
  'SupplierPaymentReceived.v1': {
    producer: 'commission-payments',
    payload: z.object({
      statementLineId: id,
      supplierId: id,
      bookingId: id.nullable(),
      amount: money,
    }),
  },
  'PayoutPaid.v1': {
    producer: 'commission-payments',
    payload: z.object({ payoutId: id, advisorId: id, amount: money }),
  },
} as const;

export type EventKey = keyof typeof eventCatalog;
export type EventPayload<K extends EventKey> = z.infer<(typeof eventCatalog)[K]['payload']>;

export function eventKey(type: string, version: number): string {
  return `${type}.v${version}`;
}

export function isKnownEvent(key: string): key is EventKey {
  return Object.prototype.hasOwnProperty.call(eventCatalog, key);
}

/** Validate a payload against the catalog. Unknown keys pass through untouched (test/internal events). */
export function parseEventPayload(type: string, version: number, payload: unknown): unknown {
  const key = eventKey(type, version);
  if (!isKnownEvent(key)) return payload;
  return eventCatalog[key].payload.parse(payload);
}
