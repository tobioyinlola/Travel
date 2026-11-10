import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type { VerifiedWebhook, WebhookProvider } from '../../../platform/webhooks/webhooks.js';
import type { Money, PaymentProviderPort } from '../application/payment-provider.port.js';

export const FAKE_PAYMENTS = 'fake-payments';
const SECRET = 'fake-payments-signing-secret';

export function signFakePayment(body: string): string {
  return createHmac('sha256', SECRET).update(body).digest('hex');
}

export function fakePaymentWebhookRequest(payload: Record<string, unknown>): {
  body: string;
  headers: Record<string, string>;
} {
  const body = JSON.stringify({ id: `evt_${randomUUID()}`, ...payload });
  return { body, headers: { 'x-fake-signature': signFakePayment(body) } };
}

/** What the fake's hosted card fields accept (Stripe-style test numbers). */
export const FAKE_CARDS: Record<string, 'succeeded' | string> = {
  '4242424242424242': 'succeeded',
  '4000000000000002': 'card_declined',
  '4000000000009995': 'insufficient_funds',
};

/**
 * Stand-in card processor. Deterministic and stateless (API and worker are separate processes): intent
 * references derive from the idempotency key, so a retried call returns the same intent.
 */
export class FakePaymentProvider implements PaymentProviderPort {
  readonly provider = FAKE_PAYMENTS;
  /** Test hooks. */
  failRefunds: string | null = null;
  refundTransportFailures = 0;
  intentTransportFailures = 0;

  async createIntent(input: { amount: Money; reference: string; idempotencyKey: string }) {
    if (this.intentTransportFailures > 0) {
      this.intentTransportFailures -= 1;
      throw new Error('fake payment provider unavailable');
    }
    const h = createHash('sha256').update(input.idempotencyKey).digest('hex');
    return {
      providerRef: `pi_${h.slice(0, 24)}`,
      clientToken: `ptok_${h.slice(24, 56)}`,
      expiresAt: new Date(Date.now() + 30 * 60_000),
    };
  }

  async refund(input: { providerRef: string; amount: Money; idempotencyKey: string }) {
    if (this.refundTransportFailures > 0) {
      this.refundTransportFailures -= 1;
      throw new Error('fake payment provider unavailable');
    }
    if (this.failRefunds) return { status: 'failed' as const, reason: this.failRefunds };
    const h = createHash('sha256').update(input.idempotencyKey).digest('hex');
    return { status: 'succeeded' as const, refundRef: `re_${h.slice(0, 24)}` };
  }
}

export interface PaymentWebhookSink {
  onPaymentResult(
    result: { intentRef: string; amountMinor: string; currency: string } & (
      { outcome: 'succeeded' } | { outcome: 'failed'; reason: string }
    ),
    tx: import('../../../platform/db/tx.js').Tx,
  ): Promise<void>;
  onDispute(
    d: { intentRef: string; disputeRef: string; amountMinor: string; reason: string },
    tx: import('../../../platform/db/tx.js').Tx,
  ): Promise<void>;
}

export function fakePaymentsWebhook(sink: PaymentWebhookSink): WebhookProvider {
  return {
    name: FAKE_PAYMENTS,
    module: 'commission-payments',
    verify(headers, raw): VerifiedWebhook {
      const sig = headers['x-fake-signature'];
      if (typeof sig !== 'string') throw new Error('missing signature');
      const expected = Buffer.from(signFakePayment(raw.toString('utf8')));
      const given = Buffer.from(sig);
      if (expected.length !== given.length || !timingSafeEqual(expected, given))
        throw new Error('bad signature');
      const body = JSON.parse(raw.toString('utf8')) as { id: string; type: string };
      return { eventId: body.id, type: body.type, payload: body };
    },
    handle: async (event, tx) => {
      const p = event.payload as Record<string, string>;
      if (event.type === 'payment.succeeded') {
        await sink.onPaymentResult(
          {
            intentRef: p.intentRef!,
            amountMinor: p.amountMinor!,
            currency: p.currency!,
            outcome: 'succeeded',
          },
          tx,
        );
      } else if (event.type === 'payment.failed') {
        await sink.onPaymentResult(
          {
            intentRef: p.intentRef!,
            amountMinor: p.amountMinor!,
            currency: p.currency!,
            outcome: 'failed',
            reason: p.reason ?? 'declined',
          },
          tx,
        );
      } else if (event.type === 'dispute.opened') {
        await sink.onDispute(
          {
            intentRef: p.intentRef!,
            disputeRef: p.disputeRef!,
            amountMinor: p.amountMinor!,
            reason: p.reason ?? 'general',
          },
          tx,
        );
      }
      // Other event types are accepted and ignored (providers send many we do not use).
    },
  };
}
