import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AuditWriter } from '../../../platform/audit/audit-writer.js';
import { Database } from '../../../platform/db/database.js';
import type { Tx } from '../../../platform/db/tx.js';
import { EventBus } from '../../../platform/events/event-bus.js';
import { JobRegistry } from '../../../platform/jobs/job-registry.js';
import { WebhookRegistry } from '../../../platform/webhooks/webhooks.js';
import { newId } from '../../shared-kernel/index.js';
import {
  fakePaymentsWebhook,
  FAKE_PAYMENTS,
  type PaymentWebhookSink,
} from '../infrastructure/fake-payment-provider.js';
import { PAYMENT_PROVIDER, type PaymentProviderPort } from './payment-provider.port.js';

interface PaymentRow {
  id: string;
  booking_id: string;
  proposal_id: string;
  advisor_id: string;
  amount_minor: string;
  currency: string;
  status:
    'requires_payment' | 'captured' | 'failed' | 'expired' | 'partially_refunded' | 'refunded';
  disputed: boolean;
  booking_closed: boolean;
  provider_ref: string | null;
  refunded_minor: string;
}

const money = (amountMinor: string | bigint, currency: string) => ({
  amountMinor: String(amountMinor),
  currency,
});

/**
 * Traveler payments (FR-PAY-01, FR-PAY-02). Booking asks for money by event; the provider's hosted fields
 * collect it; the provider's signed webhook tells us it arrived. We never see card data.
 *
 * Every provider call runs in a job, outside a database transaction (ARCH rule 7).
 */
@Injectable()
export class PaymentsService implements OnModuleInit, PaymentWebhookSink {
  private readonly logger = new Logger('Payments');

  constructor(
    private readonly db: Database,
    private readonly bus: EventBus,
    private readonly jobs: JobRegistry,
    private readonly webhooks: WebhookRegistry,
    private readonly audit: AuditWriter,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProviderPort,
  ) {}

  onModuleInit(): void {
    this.jobs.register<{ paymentId: string }>({
      name: 'payments.create-intent',
      module: 'commission-payments',
      queue: 'critical',
      handle: ({ paymentId }) => this.createIntent(paymentId),
    });
    this.jobs.register<{ refundId: string }>({
      name: 'payments.process-refund',
      module: 'commission-payments',
      queue: 'critical',
      handle: ({ refundId }) => this.processRefund(refundId),
    });
    if (this.provider.provider === FAKE_PAYMENTS) this.webhooks.register(fakePaymentsWebhook(this));

    this.bus.subscribe<{
      bookingId: string;
      proposalId: string;
      advisorId: string;
      amount: { amountMinor: string; currency: string };
    }>({
      module: 'commission-payments',
      handler: 'payments.openPayment',
      event: 'BookingPaymentRequested',
      version: 1,
      queue: 'critical',
      handle: async (e, tx) => {
        const p = e.payload;
        // A new attempt supersedes any unpaid earlier one for this booking.
        await tx.query(
          `UPDATE payments.payments SET status = 'expired', updated_at = now()
            WHERE booking_id = $1 AND status = 'requires_payment'`,
          [p.bookingId],
        );
        const id = newId();
        await tx.query(
          `INSERT INTO payments.payments (id, booking_id, proposal_id, advisor_id, amount_minor, currency, provider)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [
            id,
            p.bookingId,
            p.proposalId,
            p.advisorId,
            p.amount.amountMinor,
            p.amount.currency,
            this.provider.provider,
          ],
        );
        await tx.enqueue('payments.create-intent', { paymentId: id }, { jobKey: `intent:${id}` });
      },
    });

    // A failed booking returns everything the traveler paid (FRD: BookingFailed -> refund).
    this.bus.subscribe<{ bookingId: string }>({
      module: 'commission-payments',
      handler: 'payments.refundFailedBooking',
      event: 'BookingFailed',
      version: 1,
      queue: 'critical',
      handle: async (e, tx) => {
        await this.expireOpen(tx, e.payload.bookingId);
        await this.refundBooking(tx, e.payload.bookingId, null, 'booking_failed', e.id);
      },
    });

    // A discarded draft never had money, but an open payment attempt must not be payable any more.
    this.bus.subscribe<{ bookingId: string }>({
      module: 'commission-payments',
      handler: 'payments.closeDiscardedBooking',
      event: 'BookingDiscarded',
      version: 1,
      queue: 'critical',
      handle: (e, tx) => this.expireOpen(tx, e.payload.bookingId),
    });

    // A cancelled booking returns what the supplier's penalty leaves.
    this.bus.subscribe<{ bookingId: string; refund?: { amountMinor: string } }>({
      module: 'commission-payments',
      handler: 'payments.refundCancelledBooking',
      event: 'BookingCancelled',
      version: 1,
      queue: 'critical',
      handle: async (e, tx) => {
        await this.expireOpen(tx, e.payload.bookingId);
        const refund = e.payload.refund ? BigInt(e.payload.refund.amountMinor) : 0n;
        if (refund > 0n)
          await this.refundBooking(tx, e.payload.bookingId, refund, 'booking_cancelled', e.id);
      },
    });
  }

  private async expireOpen(tx: Tx, bookingId: string): Promise<void> {
    await tx.query(
      `UPDATE payments.payments
          SET status = CASE WHEN status = 'requires_payment' THEN 'expired' ELSE status END,
              booking_closed = true, updated_at = now()
        WHERE booking_id = $1`,
      [bookingId],
    );
  }

  // ---------- Intent creation (job) ----------

  private async createIntent(paymentId: string): Promise<void> {
    const [p] = await this.db.read<PaymentRow & { description: string | null }>(
      'commission-payments',
      'SELECT * FROM payments.payments WHERE id = $1',
      [paymentId],
    );
    if (!p || p.provider_ref || p.status !== 'requires_payment') return; // done or superseded
    const intent = await this.provider.createIntent({
      amount: money(p.amount_minor, p.currency),
      reference: p.id,
      description: `Booking ${p.booking_id}`,
      idempotencyKey: p.id,
    });
    await this.db.transaction('commission-payments', async (tx) => {
      const updated = await tx.query(
        `UPDATE payments.payments SET provider_ref = $2, client_token = $3, expires_at = $4, updated_at = now()
          WHERE id = $1 AND status = 'requires_payment' AND provider_ref IS NULL RETURNING id`,
        [p.id, intent.providerRef, intent.clientToken, intent.expiresAt],
      );
      if (updated.length === 0) return; // superseded while the provider call was running
      await tx.publish({
        type: 'PaymentIntentCreated',
        version: 1,
        payload: {
          paymentId: p.id,
          bookingId: p.booking_id,
          clientToken: intent.clientToken,
          expiresAt: intent.expiresAt.toISOString(),
          amount: money(p.amount_minor, p.currency),
        },
      });
    });
  }

  // ---------- Provider results (webhook handlers, run in a commission-payments transaction) ----------

  async onPaymentResult(
    r: { intentRef: string; amountMinor: string; currency: string } & (
      { outcome: 'succeeded' } | { outcome: 'failed'; reason: string }
    ),
    tx: Tx,
  ): Promise<void> {
    const [p] = await tx.query<PaymentRow>(
      'SELECT * FROM payments.payments WHERE provider_ref = $1 FOR UPDATE',
      [r.intentRef],
    );
    if (!p) throw new Error(`Payment webhook for unknown intent ${r.intentRef}`);

    if (r.outcome === 'failed') {
      if (p.status !== 'requires_payment') return; // late or duplicate failure: ignore
      await tx.query(
        `UPDATE payments.payments SET status = 'failed', failure_reason = $2, updated_at = now() WHERE id = $1`,
        [p.id, r.reason],
      );
      await tx.publish({
        type: 'PaymentFailed',
        version: 1,
        payload: { paymentId: p.id, bookingId: p.booking_id, reason: r.reason },
      });
      return;
    }

    if (p.status === 'captured' || p.status === 'partially_refunded' || p.status === 'refunded')
      return; // redelivery
    if (r.amountMinor !== p.amount_minor || r.currency !== p.currency) {
      // Never guess with money: park the event in the dead-letter queue for finance.
      throw new Error(
        `Payment ${p.id}: provider reported ${r.amountMinor} ${r.currency}, expected ${p.amount_minor} ${p.currency}`,
      );
    }
    // A superseded attempt can still be paid (the traveler had two tabs open). Accept the first capture for a
    // booking; refund any later one in full.
    const [other] = await tx.query<{ id: string }>(
      `SELECT id FROM payments.payments WHERE booking_id = $1 AND id <> $2
         AND status IN ('captured', 'partially_refunded', 'refunded') LIMIT 1`,
      [p.booking_id, p.id],
    );
    await tx.query(
      `UPDATE payments.payments SET status = 'captured', captured_at = now(), updated_at = now() WHERE id = $1`,
      [p.id],
    );
    await this.audit.record({
      actorType: 'system',
      actorId: null,
      action: 'payment.captured',
      entityType: 'payment',
      entityId: p.id,
      module: 'commission-payments',
      metadata: { bookingId: p.booking_id, amountMinor: p.amount_minor, currency: p.currency },
    });
    if (other || p.booking_closed) {
      // Paid twice, or paid after the booking failed or was cancelled: give it straight back.
      const reason = other ? 'duplicate_payment' : 'booking_closed';
      await this.queueRefund(tx, p, BigInt(p.amount_minor), reason, `late:${p.id}`);
      return;
    }
    await tx.publish({
      type: 'PaymentCaptured',
      version: 1,
      payload: {
        paymentId: p.id,
        proposalId: p.proposal_id,
        bookingId: p.booking_id,
        amount: money(p.amount_minor, p.currency),
      },
    });
  }

  async onDispute(
    d: { intentRef: string; disputeRef: string; amountMinor: string; reason: string },
    tx: Tx,
  ): Promise<void> {
    const [p] = await tx.query<PaymentRow>(
      'SELECT * FROM payments.payments WHERE provider_ref = $1 FOR UPDATE',
      [d.intentRef],
    );
    if (!p) throw new Error(`Dispute for unknown intent ${d.intentRef}`);
    const inserted = await tx.query(
      `INSERT INTO payments.disputes (id, payment_id, provider_ref, amount_minor, reason)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT (provider_ref) DO NOTHING RETURNING id`,
      [newId(), p.id, d.disputeRef, d.amountMinor, d.reason],
    );
    if (inserted.length === 0) return;
    await tx.query(
      `UPDATE payments.payments SET disputed = true, updated_at = now() WHERE id = $1`,
      [p.id],
    );
    await this.audit.record({
      actorType: 'system',
      actorId: null,
      action: 'payment.disputed',
      entityType: 'payment',
      entityId: p.id,
      module: 'commission-payments',
      metadata: { disputeRef: d.disputeRef, reason: d.reason, amountMinor: d.amountMinor },
    });
    this.logger.error(`Chargeback opened on payment ${p.id} (booking ${p.booking_id})`);
    await tx.publish({
      type: 'PaymentDisputed',
      version: 1,
      payload: {
        paymentId: p.id,
        bookingId: p.booking_id,
        amount: money(d.amountMinor, p.currency),
      },
    });
  }

  // ---------- Refunds ----------

  /**
   * Queue refunds for a booking: `amount` null means everything still refundable. Spread across the booking's
   * captured payments, oldest first. Keyed by cause, so a redelivered event cannot refund twice.
   */
  private async refundBooking(
    tx: Tx,
    bookingId: string,
    amount: bigint | null,
    reason: string,
    causeId: string,
  ): Promise<void> {
    const payments = await tx.query<PaymentRow>(
      `SELECT * FROM payments.payments WHERE booking_id = $1
         AND status IN ('captured', 'partially_refunded') ORDER BY captured_at FOR UPDATE`,
      [bookingId],
    );
    let remaining = amount;
    for (const p of payments) {
      const refundable = BigInt(p.amount_minor) - BigInt(p.refunded_minor);
      const pending = await tx.query<{ n: string }>(
        `SELECT coalesce(sum(amount_minor), 0)::text AS n FROM payments.refunds
          WHERE payment_id = $1 AND status = 'pending'`,
        [p.id],
      );
      const available = refundable - BigInt(pending[0]!.n);
      const take = remaining === null ? available : remaining < available ? remaining : available;
      if (take <= 0n) continue;
      await this.queueRefund(tx, p, take, reason, `${causeId}:${p.id}`);
      if (remaining !== null) remaining -= take;
      if (remaining !== null && remaining <= 0n) break;
    }
  }

  private async queueRefund(
    tx: Tx,
    p: PaymentRow,
    amount: bigint,
    reason: string,
    key: string,
  ): Promise<void> {
    const id = newId();
    const inserted = await tx.query(
      `INSERT INTO payments.refunds (id, payment_id, booking_id, amount_minor, reason, idempotency_key)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (idempotency_key) DO NOTHING RETURNING id`,
      [id, p.id, p.booking_id, amount, reason, key],
    );
    if (inserted.length === 0) return;
    await tx.enqueue('payments.process-refund', { refundId: id }, { jobKey: `refund:${id}` });
  }

  private async processRefund(refundId: string): Promise<void> {
    const [r] = await this.db.read<{
      id: string;
      payment_id: string;
      booking_id: string;
      amount_minor: string;
      reason: string;
      status: string;
      idempotency_key: string;
      provider_ref: string;
      currency: string;
    }>(
      'commission-payments',
      `SELECT r.*, p.provider_ref, p.currency FROM payments.refunds r JOIN payments.payments p ON p.id = r.payment_id
        WHERE r.id = $1`,
      [refundId],
    );
    if (!r || r.status !== 'pending') return;
    const result = await this.provider.refund({
      providerRef: r.provider_ref,
      amount: money(r.amount_minor, r.currency),
      idempotencyKey: r.idempotency_key,
      reason: r.reason,
    });
    await this.db.transaction('commission-payments', async (tx) => {
      if (result.status === 'failed') {
        await tx.query(
          `UPDATE payments.refunds SET status = 'failed', failure_reason = $2, completed_at = now() WHERE id = $1`,
          [r.id, result.reason],
        );
        // Needs a person: finance sees it in the audit log and the error stream until the console ships.
        this.logger.error(`Refund ${r.id} for booking ${r.booking_id} failed: ${result.reason}`);
        await this.audit.record({
          actorType: 'system',
          actorId: null,
          action: 'refund.failed',
          entityType: 'payment',
          entityId: r.payment_id,
          module: 'commission-payments',
          metadata: { refundId: r.id, reason: result.reason },
        });
        return;
      }
      await tx.query(
        `UPDATE payments.refunds SET status = 'succeeded', provider_ref = $2, completed_at = now() WHERE id = $1`,
        [r.id, result.refundRef],
      );
      await tx.query(
        `UPDATE payments.payments
            SET refunded_minor = refunded_minor + $2,
                status = CASE WHEN refunded_minor + $2 >= amount_minor THEN 'refunded' ELSE 'partially_refunded' END,
                updated_at = now()
          WHERE id = $1`,
        [r.payment_id, r.amount_minor],
      );
      await this.audit.record({
        actorType: 'system',
        actorId: null,
        action: 'refund.issued',
        entityType: 'payment',
        entityId: r.payment_id,
        module: 'commission-payments',
        metadata: { refundId: r.id, amountMinor: r.amount_minor, reason: r.reason },
      });
      await tx.publish({
        type: 'RefundIssued',
        version: 1,
        payload: {
          paymentId: r.payment_id,
          bookingId: r.booking_id,
          amount: money(r.amount_minor, r.currency),
          reason: r.reason,
        },
      });
    });
  }
}
