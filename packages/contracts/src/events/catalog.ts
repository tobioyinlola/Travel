import { z } from 'zod';

const id = z.uuid();
const paymentMode = z.enum(['pay_at_hotel', 'prepay', 'deposit']);
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
  /**
   * Carries everything Booking needs to prepare checkout, because Booking (same layer) may not call
   * Itineraries. Added in Sprint 4 as optional fields; `hotels` is empty for a trip with nothing to book.
   * `tokenHash` is the SHA-256 of the traveler link token, never the token itself.
   */
  'ProposalApproved.v1': {
    producer: 'itineraries',
    payload: z.object({
      proposalId: id,
      proposalVersion: z.number().int(),
      tripId: id,
      advisorId: id,
      advisorUserId: id,
      tripTitle: z.string(),
      decidedByName: z.string(),
      tokenHash: z.string().optional(),
      linkExpiresAt: z.iso.datetime().optional(),
      currency: z.string().length(3).optional(),
      hotels: z
        .array(
          z.object({
            itemId: id,
            propertyId: id.optional(),
            rateCodes: z.array(z.string()).optional(),
            supplier: z.string(),
            rateKey: z.string(),
            propertyName: z.string(),
            city: z.string(),
            checkIn: z.iso.date(),
            checkOut: z.iso.date(),
            nights: z.number().int(),
            roomName: z.string(),
            board: z.string(),
            adults: z.number().int(),
            childrenAges: z.array(z.number().int()),
            total: money,
            feesAtHotel: money,
            commissionable: money,
            commissionBps: z.number().int(),
            paymentModes: z.array(paymentMode),
            refundable: z.boolean(),
            freeCancellationUntil: z.iso.datetime().nullable(),
            cancellationPolicy: z.string(),
          }),
        )
        .optional(),
    }),
  },
  'ProposalChangesRequested.v1': {
    producer: 'itineraries',
    payload: z.object({
      proposalId: id,
      tripId: id,
      advisorId: id,
      advisorUserId: id,
      tripTitle: z.string(),
      decidedByName: z.string(),
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
      tripTitle: z.string(),
      decidedByName: z.string(),
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
  /** Booking asks Payments to collect the traveler's money (prepay or deposit). */
  'BookingPaymentRequested.v1': {
    producer: 'booking',
    payload: z.object({
      bookingId: id,
      proposalId: id,
      advisorId: id,
      amount: money,
      description: z.string(),
    }),
  },
  /** A payment is ready for the traveler to complete with the provider's hosted fields. */
  'PaymentIntentCreated.v1': {
    producer: 'commission-payments',
    payload: z.object({
      paymentId: id,
      bookingId: id,
      clientToken: z.string(),
      expiresAt: z.iso.datetime(),
      amount: money,
    }),
  },
  'PaymentCaptured.v1': {
    producer: 'commission-payments',
    payload: z.object({
      paymentId: id,
      proposalId: id,
      amount: money,
      bookingId: id.optional(),
    }),
  },
  'PaymentFailed.v1': {
    producer: 'commission-payments',
    payload: z.object({ paymentId: id, bookingId: id, reason: z.string() }),
  },
  'RefundIssued.v1': {
    producer: 'commission-payments',
    payload: z.object({ paymentId: id, bookingId: id, amount: money, reason: z.string() }),
  },
  /** The traveler could not go ahead: a price moved or a hotel sold out. The advisor needs to reprice. */
  'BookingBlocked.v1': {
    producer: 'booking',
    payload: z.object({
      bookingId: id,
      tripId: id,
      advisorId: id,
      advisorUserId: id,
      tripTitle: z.string(),
      reason: z.string(),
    }),
  },
  /** An unpaid draft was dropped so the trip can be edited and proposed again. */
  'BookingDiscarded.v1': {
    producer: 'booking',
    payload: z.object({ bookingId: id, tripId: id, proposalId: id, advisorId: id }),
  },
  /** A chargeback was opened with the card network. Finance and support handle it (FR-PAY-02). */
  'PaymentDisputed.v1': {
    producer: 'commission-payments',
    payload: z.object({ paymentId: id, bookingId: id, amount: money }),
  },
  /**
   * Booking outcomes. Notifications reads the traveler and advisor details from here (it may not call
   * Booking). `supplierId` predates multi-hotel bookings and is no longer sent.
   */
  'BookingConfirmed.v1': {
    producer: 'booking',
    payload: z.object({
      bookingId: id,
      tripId: id,
      advisorId: id,
      supplierId: id.optional(),
      advisorUserId: id.optional(),
      tripTitle: z.string().optional(),
      travelerName: z.string().optional(),
      travelerEmail: z.string().optional(),
      total: money.optional(),
      lines: z
        .array(
          z.object({
            lineId: id.optional(),
            propertyId: id.optional(),
            rateCodes: z.array(z.string()).optional(),
            supplier: z.string(),
            propertyName: z.string(),
            checkIn: z.iso.date(),
            checkOut: z.iso.date(),
            confirmationCode: z.string(),
            total: money,
            commissionable: money,
            commissionBps: z.number().int(),
          }),
        )
        .optional(),
    }),
  },
  'BookingFailed.v1': {
    producer: 'booking',
    payload: z.object({
      bookingId: id,
      tripId: id,
      advisorId: id,
      reason: z.string(),
      advisorUserId: id.optional(),
      tripTitle: z.string().optional(),
      travelerName: z.string().optional(),
      travelerEmail: z.string().optional(),
    }),
  },
  'BookingCancelled.v1': {
    producer: 'booking',
    payload: z.object({
      bookingId: id,
      advisorId: id,
      tripId: id.optional(),
      advisorUserId: id.optional(),
      tripTitle: z.string().optional(),
      travelerName: z.string().optional(),
      travelerEmail: z.string().optional(),
      /** What goes back to the traveler after supplier penalties. */
      refund: money.optional(),
      penalty: money.optional(),
    }),
  },
  /** The lead guest on a confirmed booking was changed and every hotel acknowledged it. */
  'BookingModified.v1': {
    producer: 'booking',
    payload: z.object({
      bookingId: id,
      tripId: id,
      advisorId: id,
      advisorUserId: id,
      tripTitle: z.string(),
      travelerName: z.string(),
      travelerEmail: z.string(),
    }),
  },
  /** One or more hotels would not take the change: the advisor must sort it out with them directly. */
  'BookingModificationFailed.v1': {
    producer: 'booking',
    payload: z.object({
      bookingId: id,
      tripId: id,
      advisorId: id,
      advisorUserId: id,
      tripTitle: z.string(),
      hotels: z.array(z.string()),
    }),
  },
  /** Something about a booking changed; drives the advisor's live status stream (no business meaning). */
  'BookingUpdated.v1': {
    producer: 'booking',
    payload: z.object({ bookingId: id, tripId: id, advisorId: id, status: z.string() }),
  },
  'BookingCompleted.v1': {
    producer: 'booking',
    payload: z.object({ bookingId: id, advisorId: id }),
  },
  /** Commission earned on one hotel booking, split between advisor and platform at the moment of recognition. */
  'CommissionRecognized.v1': {
    producer: 'commission-payments',
    payload: z.object({
      commissionId: id,
      bookingId: id,
      advisorId: id,
      supplier: z.string(),
      commissionable: money,
      expected: money,
      advisorShare: money,
      platformShare: money,
      advisorShareBps: z.number().int(),
      tierCode: z.string(),
      recognizedAt: z.iso.datetime(),
    }),
  },
  /** The supplier paid: the advisor's share is now payable (FR-COM-05). */
  'CommissionReleased.v1': {
    producer: 'commission-payments',
    payload: z.object({ commissionId: id, bookingId: id, advisorId: id, amount: money }),
  },
  'CommissionReversed.v1': {
    producer: 'commission-payments',
    payload: z.object({
      commissionId: id,
      bookingId: id,
      advisorId: id,
      commissionable: money,
      advisorShare: money,
      reason: z.string(),
      /** The advisor's share had already become payable: it is taken back from the next payout. */
      wasPayable: z.boolean(),
    }),
  },
  /** A supplier paid commission on a booking (from an imported statement line). */
  'SupplierPaymentReceived.v1': {
    producer: 'commission-payments',
    payload: z.object({
      statementLineId: id,
      supplierId: id.optional(),
      supplier: z.string().optional(),
      bookingId: id.nullable(),
      amount: money,
    }),
  },
  'PayoutPaid.v1': {
    producer: 'commission-payments',
    payload: z.object({
      payoutId: id,
      advisorId: id,
      amount: money,
      advisorUserId: id.optional(),
      gross: money.optional(),
      debtApplied: money.optional(),
    }),
  },
  'PayoutFailed.v1': {
    producer: 'commission-payments',
    payload: z.object({ payoutId: id, advisorId: id, amount: money, reason: z.string() }),
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
