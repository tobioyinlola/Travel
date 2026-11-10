export interface PayoutMoney {
  amountMinor: string;
  currency: string;
}

/**
 * Pays advisors in their local currency (FR-COM-07). The advisor's bank details live with the provider; we hold
 * only the provider's account reference.
 */
export interface PayoutProviderPort {
  readonly provider: string;
  /** Idempotent by key. Throws on transport errors (the job retries); returns `failed` for refusals. */
  createPayout(input: {
    accountRef: string;
    amount: PayoutMoney;
    idempotencyKey: string;
    reference: string;
  }): Promise<{ status: 'sent'; payoutRef: string } | { status: 'failed'; reason: string }>;
}

export const PAYOUT_PROVIDER = Symbol('PayoutProviderPort');
