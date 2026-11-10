import { createHash } from 'node:crypto';
import type { PayoutMoney, PayoutProviderPort } from '../application/payout-provider.port.js';

/**
 * Stand-in payout rails. Stateless and idempotent by key. Account references: `acct_fake_closed` is refused,
 * anything else is accepted. Test hooks: transport failures and a record of calls.
 */
export class FakePayoutProvider implements PayoutProviderPort {
  readonly provider = 'fake-payouts';
  transportFailures = 0;
  readonly calls: Array<{ accountRef: string; amount: PayoutMoney; idempotencyKey: string }> = [];

  async createPayout(input: { accountRef: string; amount: PayoutMoney; idempotencyKey: string }) {
    this.calls.push({
      accountRef: input.accountRef,
      amount: input.amount,
      idempotencyKey: input.idempotencyKey,
    });
    if (this.transportFailures > 0) {
      this.transportFailures -= 1;
      throw new Error('fake payout provider unavailable');
    }
    if (input.accountRef === 'acct_fake_closed')
      return { status: 'failed' as const, reason: 'account_closed' };
    const h = createHash('sha256').update(input.idempotencyKey).digest('hex');
    return { status: 'sent' as const, payoutRef: `po_${h.slice(0, 24)}` };
  }
}
