import { randomUUID } from 'node:crypto';
import type { Money } from '../../shared-kernel/index.js';
import type { BillingPort } from '../application/billing.port.js';

/**
 * Stand-in card processor. Payment method tokens (what a provider's hosted card field would return):
 *   pm_fake_visa      -> succeeds
 *   pm_fake_declined  -> card declined
 *   pm_fake_error     -> provider unreachable (throws; the job retries)
 * Charges are idempotent by key, like real providers.
 */
export class FakeBilling implements BillingPort {
  readonly provider = 'fake-billing';
  readonly charges = new Map<string, { chargeRef: string; amount: Money }>();

  async charge(input: { paymentMethodRef: string; amount: Money; idempotencyKey: string }) {
    const prior = this.charges.get(input.idempotencyKey);
    if (prior) return { status: 'succeeded' as const, chargeRef: prior.chargeRef };
    if (input.paymentMethodRef === 'pm_fake_error')
      throw new Error('fake billing provider unavailable');
    if (
      input.paymentMethodRef === 'pm_fake_declined' ||
      !input.paymentMethodRef.startsWith('pm_fake_')
    ) {
      return { status: 'declined' as const, reason: 'card_declined' };
    }
    const chargeRef = `ch_${randomUUID()}`;
    this.charges.set(input.idempotencyKey, { chargeRef, amount: input.amount });
    return { status: 'succeeded' as const, chargeRef };
  }
}
