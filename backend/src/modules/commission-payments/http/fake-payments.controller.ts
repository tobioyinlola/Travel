import { Controller, HttpCode, HttpStatus, Param, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Database } from '../../../platform/db/database.js';
import { Public } from '../../../platform/http/auth.js';
import { ProblemException, problemType } from '../../../platform/http/problem.js';
import { ZBody, ZResponse } from '../../../platform/http/zod.js';
import { WebhookInbox } from '../../../platform/webhooks/webhooks.js';
import {
  FAKE_CARDS,
  FAKE_PAYMENTS,
  fakePaymentWebhookRequest,
} from '../infrastructure/fake-payment-provider.js';

const cardSchema = z.object({ cardNumber: z.string().regex(/^[0-9 ]{12,23}$/) });
const disputeSchema = z.object({ reason: z.string().max(100).default('fraudulent') });

interface PaymentLookup {
  provider_ref: string;
  amount_minor: string;
  currency: string;
  status: string;
}

/**
 * Development only (PROVIDERS_MODE=fake): stands in for the provider's hosted card fields. In production the
 * traveler's browser talks to the provider directly and this controller does not exist. "Paying" makes the
 * fake provider send its signed webhook through the real inbox pipeline.
 */
@ApiTags('dev')
@Controller({ path: 'dev/fake-payments', version: '1' })
@Public()
export class FakePaymentsController {
  constructor(
    private readonly db: Database,
    private readonly inbox: WebhookInbox,
  ) {}

  private async byToken(clientToken: string): Promise<PaymentLookup> {
    const [p] = await this.db.read<PaymentLookup>(
      'commission-payments',
      `SELECT provider_ref, amount_minor, currency, status FROM payments.payments WHERE client_token = $1`,
      [clientToken],
    );
    if (!p)
      throw new ProblemException(404, problemType('not-found'), 'This payment link is not valid');
    return p;
  }

  @Post(':clientToken/pay')
  @HttpCode(HttpStatus.OK)
  @ZResponse(200, z.object({ status: z.enum(['succeeded', 'declined']), reason: z.string() }))
  async pay(
    @Param('clientToken') clientToken: string,
    @ZBody(cardSchema) body: z.infer<typeof cardSchema>,
  ) {
    const p = await this.byToken(clientToken);
    if (p.status !== 'requires_payment')
      throw new ProblemException(
        409,
        problemType('payment-not-open'),
        'This payment can no longer be paid',
      );
    const outcome = FAKE_CARDS[body.cardNumber.replaceAll(' ', '')] ?? 'invalid_card';
    const common = { intentRef: p.provider_ref, amountMinor: p.amount_minor, currency: p.currency };
    const { body: raw, headers } = fakePaymentWebhookRequest(
      outcome === 'succeeded'
        ? { type: 'payment.succeeded', ...common }
        : { type: 'payment.failed', reason: outcome, ...common },
    );
    await this.inbox.receive(FAKE_PAYMENTS, headers, Buffer.from(raw));
    return { status: outcome === 'succeeded' ? 'succeeded' : 'declined', reason: outcome };
  }

  /** Simulate the cardholder's bank opening a chargeback. */
  @Post(':clientToken/dispute')
  @HttpCode(HttpStatus.ACCEPTED)
  async dispute(
    @Param('clientToken') clientToken: string,
    @ZBody(disputeSchema) body: z.infer<typeof disputeSchema>,
  ) {
    const p = await this.byToken(clientToken);
    const { body: raw, headers } = fakePaymentWebhookRequest({
      type: 'dispute.opened',
      intentRef: p.provider_ref,
      disputeRef: `dp_${p.provider_ref}`,
      amountMinor: p.amount_minor,
      currency: p.currency,
      reason: body.reason,
    });
    await this.inbox.receive(FAKE_PAYMENTS, headers, Buffer.from(raw));
    return { sent: true };
  }
}
