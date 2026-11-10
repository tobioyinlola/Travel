import type { Money } from '../../shared-kernel/index.js';

/**
 * Card charges for membership fees. Separate from Payments' PaymentProviderPort (traveler funds): Membership
 * sits in a lower layer than Payments and may not call it, and subscription billing is usually a different
 * product of the same provider anyway (ADR-11).
 */
export interface BillingPort {
  readonly provider: string;
  /** Throws on transport errors (the job retries); returns `declined` for card declines (no retry). */
  charge(input: {
    paymentMethodRef: string;
    amount: Money;
    idempotencyKey: string;
    description: string;
  }): Promise<{ status: 'succeeded'; chargeRef: string } | { status: 'declined'; reason: string }>;
}

export const BILLING_PORT = Symbol('BillingPort');
