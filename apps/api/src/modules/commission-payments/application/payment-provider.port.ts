/** Plain wire shape (minor units as a string), as carried in events. */
export interface Money {
  amountMinor: string;
  currency: string;
}

/**
 * Traveler payments (FR-PAY-01). PCI-minimal: the traveler's browser talks to the provider's hosted fields
 * with `clientToken`; our servers only ever see references. The charge itself is captured by the provider
 * and reported back by a signed webhook.
 */
export interface PaymentProviderPort {
  readonly provider: string;
  /** Idempotent by key. Throws on transport errors (the job retries). */
  createIntent(input: {
    amount: Money;
    reference: string;
    description: string;
    idempotencyKey: string;
  }): Promise<{ providerRef: string; clientToken: string; expiresAt: Date }>;
  /** Idempotent by key. Returns `failed` for definitive refusals; throws on transport errors. */
  refund(input: {
    providerRef: string;
    amount: Money;
    idempotencyKey: string;
    reason: string;
  }): Promise<{ status: 'succeeded'; refundRef: string } | { status: 'failed'; reason: string }>;
}

export const PAYMENT_PROVIDER = Symbol('PaymentProviderPort');
