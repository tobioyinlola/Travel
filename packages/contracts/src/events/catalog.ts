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
const advisorStatus = z.enum([
  'applied',
  'under_review',
  'approved',
  'active',
  'suspended',
  'offboarded',
  'rejected',
]);

export const eventCatalog = {
  // ---- Identity (Sprint 1) ----
  /** Carries contact details so Notifications can keep its own recipient list (it may not call Identity). */
  'UserRegistered.v1': {
    producer: 'identity',
    payload: z.object({
      userId: id,
      role: z.string(),
      email: z.string().nullable(),
      phone: z.string().nullable(),
      displayName: z.string().nullable(),
    }),
  },
  /**
   * One-time code to deliver. The code is short-lived (minutes) and single-use; it sits in the outbox only
   * until the 14-day outbox cleanup. Accepted trade-off so Identity need not call Notifications.
   */
  'VerificationCodeIssued.v1': {
    producer: 'identity',
    payload: z.object({
      userId: id,
      channel: z.enum(['email', 'sms']),
      destination: z.string(),
      code: z.string().regex(/^\d{6}$/),
      expiresAt: z.iso.datetime(),
    }),
  },
  'AdvisorApplicationSubmitted.v1': {
    producer: 'identity',
    payload: z.object({ advisorId: id, userId: id }),
  },
  'AdvisorStatusChanged.v1': {
    producer: 'identity',
    payload: z.object({
      advisorId: id,
      userId: id,
      from: advisorStatus.nullable(),
      to: advisorStatus,
    }),
  },
  'AdvisorApplicationAccepted.v1': {
    producer: 'identity',
    payload: z.object({ advisorId: id, userId: id }),
  },
  'AdvisorApplicationRejected.v1': {
    producer: 'identity',
    payload: z.object({ advisorId: id, userId: id }),
  },
  'AdvisorInformationRequested.v1': {
    producer: 'identity',
    payload: z.object({ advisorId: id, userId: id, note: z.string().max(2000) }),
  },
  'AdvisorApproved.v1': {
    producer: 'identity',
    payload: z.object({ advisorId: id, userId: id }),
  },
  'AdvisorActivated.v1': {
    producer: 'identity',
    payload: z.object({ advisorId: id, userId: id }),
  },
  // ---- Membership (Sprint 1) ----
  'MembershipInvoicePaid.v1': {
    producer: 'membership',
    payload: z.object({ invoiceId: id, membershipId: id, advisorId: id, userId: id, total: money }),
  },
  'MembershipPaymentFailed.v1': {
    producer: 'membership',
    payload: z.object({
      invoiceId: id,
      membershipId: id,
      advisorId: id,
      userId: id,
      reason: z.string(),
    }),
  },
  'MembershipCancelled.v1': {
    producer: 'membership',
    payload: z.object({ membershipId: id, advisorId: id, userId: id, endsAt: z.iso.datetime() }),
  },
  // ---- Learning (Sprint 2) ----
  'CoursePassed.v1': {
    producer: 'learning',
    payload: z.object({
      courseId: id,
      courseSlug: z.string(),
      advisorId: id,
      userId: id,
      scorePct: z.number().int(),
    }),
  },
  // ---- Clients (Sprint 2) ----
  /** A verified privacy deletion: every module holding this client's personal data must erase it (FR-CRM-08). */
  'ClientDataErased.v1': {
    producer: 'clients',
    payload: z.object({ clientId: id, advisorId: id, privacyRequestId: id }),
  },
  // ---- Partners (Sprint 3) ----
  /** Program state for Catalog's preferred-partner marking (Catalog may not call Partners: same layer). */
  'PartnerProgramChanged.v1': {
    producer: 'partners',
    payload: z.object({
      programId: id,
      name: z.string(),
      tier: z.string(),
      active: z.boolean(),
      propertyIds: z.array(id),
      perks: z.array(z.object({ kind: z.string(), description: z.string() })),
      rateCodes: z.array(z.string()),
    }),
  },
  // ---- Core events from ARCH ----
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
    payload: z.object({
      proposalId: id,
      proposalVersion: z.number().int(),
      tripId: id,
      advisorId: id,
      advisorUserId: id,
    }),
  },
  /**
   * Proposal emailed to the traveler. Carries the secret link (like VerificationCodeIssued carries a code);
   * Notifications stores the message body redacted. The link expires with the proposal token.
   */
  'ProposalSent.v1': {
    producer: 'itineraries',
    payload: z.object({
      proposalId: id,
      advisorId: id,
      advisorName: z.string(),
      recipientEmail: z.string(),
      recipientName: z.string(),
      url: z.string(),
      expiresAt: z.iso.datetime(),
    }),
  },
  'ProposalApproved.v1': {
    producer: 'itineraries',
    payload: z.object({
      proposalId: id,
      proposalVersion: z.number().int(),
      tripId: id,
      advisorId: id,
      advisorUserId: id,
    }),
  },
  'ProposalChangesRequested.v1': {
    producer: 'itineraries',
    payload: z.object({
      proposalId: id,
      tripId: id,
      advisorId: id,
      advisorUserId: id,
      note: z.string(),
    }),
  },
  'ProposalDeclined.v1': {
    producer: 'itineraries',
    payload: z.object({
      proposalId: id,
      tripId: id,
      advisorId: id,
      advisorUserId: id,
      note: z.string(),
    }),
  },
  /** Trip summary for the CRM's trip history (FR-CRM-03). */
  'TripUpdated.v1': {
    producer: 'itineraries',
    payload: z.object({
      tripId: id,
      clientId: id,
      advisorId: id,
      title: z.string(),
      startDate: z.iso.date().nullable(),
      endDate: z.iso.date().nullable(),
      status: z.string(),
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
