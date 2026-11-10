import { createHash } from 'node:crypto';
import { HttpStatus, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import type { EventPayload } from '@atp/contracts';
import type { Redis } from 'ioredis';
import { AuditWriter } from '../../../platform/audit/audit-writer.js';
import { Database } from '../../../platform/db/database.js';
import { FeatureFlags } from '../../../platform/feature-flags.js';
import { MetricsRegistry } from '../../../platform/metrics.js';
import type { Tx } from '../../../platform/db/tx.js';
import { EventBus } from '../../../platform/events/event-bus.js';
import { ProblemException, problemType } from '../../../platform/http/problem.js';
import { JobRegistry, type JobContext } from '../../../platform/jobs/job-registry.js';
import { FieldCrypto } from '../../../platform/security/field-crypto.js';
import { REDIS } from '../../../platform/tokens.js';
import { CatalogApi, type PaymentMode } from '../../catalog/index.js';
import { IdentityApi } from '../../identity/index.js';
import { newId } from '../../shared-kernel/index.js';
import { bookingMachine, type BookingStatus } from '../domain/state.js';
import {
  cancellationPenalty,
  dueNow,
  paymentOptions,
  refundAfterPenalty,
  type LineTerms,
} from '../domain/terms.js';

const problem = (status: HttpStatus, slug: string, title: string, detail?: string) =>
  new ProblemException(status, problemType(slug), title, detail);

const REQUESTS_PER_MINUTE = 60;
/** A confirmed-payment booking still waiting on suppliers after this long goes to the support queue. */
export const STUCK_AFTER_MINUTES = 15;
const RESERVE_ATTEMPTS = 8;
/** A payment request with no provider answer after this long may be asked for again. */
const INTENT_GRACE_MS = 2 * 60_000;

interface BookingRow {
  id: string;
  proposal_id: string;
  trip_id: string;
  owner_advisor_id: string;
  advisor_user_id: string;
  trip_title: string;
  currency: string;
  status: BookingStatus;
  payment_mode: PaymentMode | null;
  total_minor: string;
  due_now_minor: string;
  paid_minor: string;
  refunded_minor: string;
  penalty_minor: string;
  payment_state: 'none' | 'awaiting' | 'captured' | 'failed' | 'partially_refunded' | 'refunded';
  payment_client_token: string | null;
  payment_expires_at: Date | null;
  payment_failure: string | null;
  traveler_enc: string | null;
  confirm_key: string | null;
  failure_reason: string | null;
  cancel_requested_at: Date | null;
  guest_version: number;
  link_expires_at: Date;
  pending_since: Date | null;
  confirmed_at: Date | null;
  cancelled_at: Date | null;
  blocked_notified_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface LineRow {
  id: string;
  booking_id: string;
  position: number;
  status: 'pending' | 'confirmed' | 'failed' | 'cancelled';
  supplier: string;
  rate_key: string;
  property_name: string;
  city: string;
  check_in: string;
  check_out: string;
  nights: number;
  room_name: string;
  board: string;
  adults: number;
  children_ages: number[];
  total_minor: string;
  fees_at_hotel_minor: string;
  commissionable_minor: string;
  commission_bps: number;
  payment_modes: PaymentMode[];
  refundable: boolean;
  free_cancellation_until: Date | null;
  cancellation_policy: string;
  supplier_ref: string | null;
  confirmation_code: string | null;
  failure_reason: string | null;
  penalty_minor: string;
  attempts: number;
  property_id: string | null;
  rate_codes: string[];
  guest_version: number;
  amend_failed: boolean;
}

interface Traveler {
  name: string;
  email: string;
  phone: string | null;
  specialRequests: string | null;
}

export interface ConfirmInput {
  traveler: { name: string; email: string; phone?: string | null; specialRequests?: string | null };
  paymentMode: PaymentMode;
}

const BOOKING_COLUMNS = 'b.*';
const LINE_SELECT = `SELECT id, booking_id, position, status, supplier, rate_key, property_name, city,
  to_char(check_in, 'YYYY-MM-DD') AS check_in, to_char(check_out, 'YYYY-MM-DD') AS check_out, nights, room_name, board,
  adults, children_ages, total_minor, fees_at_hotel_minor, commissionable_minor, commission_bps, payment_modes,
  refundable, free_cancellation_until, cancellation_policy, supplier_ref, confirmation_code, failure_reason,
  penalty_minor, attempts, property_id, rate_codes, guest_version, amend_failed FROM booking.lines`;

const m = (minor: string | bigint, currency: string) => ({
  amountMinor: String(minor),
  currency,
});
const iso = (d: Date | null) => (d ? d.toISOString() : null);

/**
 * Bookings (FR-BKG-01..06). A booking is created when the traveler approves a proposal and walks through
 * draft -> pending -> confirmed on the FRD state machine. Money moves through Payments by events; suppliers are
 * called from jobs, never inside a database transaction (ARCH rule 7), with the same idempotency key on every
 * retry so a retry can never double-book (AC-04).
 */
@Injectable()
export class BookingService implements OnModuleInit {
  private readonly logger = new Logger('Booking');

  constructor(
    private readonly db: Database,
    private readonly bus: EventBus,
    private readonly jobs: JobRegistry,
    private readonly audit: AuditWriter,
    private readonly crypto: FieldCrypto,
    private readonly catalog: CatalogApi,
    private readonly identity: IdentityApi,
    private readonly flags: FeatureFlags,
    private readonly metrics: MetricsRegistry,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  onModuleInit(): void {
    this.metrics.gauge(
      'atp_booking_failure_ratio_10m',
      'Share of bookings that failed among those that confirmed or failed in the last 10 minutes (SLO alert: > 0.02).',
      async () => {
        const rows = await this.system((tx) =>
          tx.query<{ ok: string; bad: string }>(
            `SELECT count(*) FILTER (WHERE status IN ('confirmed', 'completed', 'cancelled', 'modified') AND confirmed_at > now() - interval '10 minutes')::text AS ok,
                    count(*) FILTER (WHERE status = 'failed' AND updated_at > now() - interval '10 minutes')::text AS bad
               FROM booking.bookings`,
          ),
        );
        const ok = Number(rows[0]!.ok);
        const bad = Number(rows[0]!.bad);
        return ok + bad === 0 ? 0 : Math.round((bad / (ok + bad)) * 1000) / 1000;
      },
    );
    this.metrics.gauge(
      'atp_bookings_stuck_pending',
      'Bookings waiting on suppliers for more than 15 minutes.',
      async () => {
        const { items } = await this.stuck();
        return items.length;
      },
    );
    this.jobs.register<{ lineId: string }>({
      name: 'booking.reserve-line',
      module: 'booking',
      queue: 'critical',
      maxAttempts: RESERVE_ATTEMPTS,
      handle: (p, ctx) => this.reserveLine(p.lineId, ctx),
    });
    this.jobs.register<{ lineId: string }>({
      name: 'booking.cancel-line',
      module: 'booking',
      queue: 'critical',
      maxAttempts: RESERVE_ATTEMPTS,
      handle: (p) => this.cancelLine(p.lineId),
    });
    this.jobs.register<{ lineId: string; version: number }>({
      name: 'booking.amend-line',
      module: 'booking',
      queue: 'critical',
      maxAttempts: RESERVE_ATTEMPTS,
      handle: (p, ctx) => this.amendLine(p.lineId, p.version, ctx),
    });
    this.jobs.register<Record<string, never>>({
      name: 'booking.alert-stuck',
      module: 'booking',
      queue: 'default',
      cron: '*/5 * * * *',
      handle: () => this.alertStuck(),
    });
    this.jobs.register<Record<string, never>>({
      name: 'booking.complete-stays',
      module: 'booking',
      queue: 'default',
      cron: '15 3 * * *',
      handle: () => this.completeStays(),
    });

    this.bus.subscribe<EventPayload<'ProposalApproved.v1'>>({
      module: 'booking',
      handler: 'booking.prepareCheckout',
      event: 'ProposalApproved',
      version: 1,
      handle: async (e, tx) => {
        await this.prepareCheckout(e.payload, tx);
        await this.touch(tx, 'proposal_id', e.payload.proposalId);
      },
    });
    this.bus.subscribe<EventPayload<'PaymentIntentCreated.v1'>>({
      module: 'booking',
      handler: 'booking.onPaymentIntentCreated',
      event: 'PaymentIntentCreated',
      version: 1,
      queue: 'critical',
      handle: async (e, tx) => {
        await tx.setLocal('atp.scope', 'all');
        await tx.query(
          `UPDATE booking.bookings SET payment_client_token = $2, payment_expires_at = $3, updated_at = now()
            WHERE id = $1 AND status = 'draft' AND payment_state = 'awaiting'`,
          [e.payload.bookingId, e.payload.clientToken, e.payload.expiresAt],
        );
        await this.touch(tx, 'id', e.payload.bookingId);
      },
    });
    this.bus.subscribe<EventPayload<'PaymentCaptured.v1'>>({
      module: 'booking',
      handler: 'booking.onPaymentCaptured',
      event: 'PaymentCaptured',
      version: 1,
      queue: 'critical',
      handle: async (e, tx) => {
        await this.onPaymentCaptured(e.payload, tx);
        if (e.payload.bookingId) await this.touch(tx, 'id', e.payload.bookingId);
      },
    });
    this.bus.subscribe<EventPayload<'PaymentFailed.v1'>>({
      module: 'booking',
      handler: 'booking.onPaymentFailed',
      event: 'PaymentFailed',
      version: 1,
      queue: 'critical',
      handle: async (e, tx) => {
        await tx.setLocal('atp.scope', 'all');
        await tx.query(
          `UPDATE booking.bookings SET payment_state = 'failed', payment_failure = $2,
                  payment_client_token = NULL, payment_expires_at = NULL, updated_at = now()
            WHERE id = $1 AND status = 'draft' AND payment_state = 'awaiting'`,
          [e.payload.bookingId, e.payload.reason],
        );
        await this.touch(tx, 'id', e.payload.bookingId);
      },
    });
    this.bus.subscribe<EventPayload<'RefundIssued.v1'>>({
      module: 'booking',
      handler: 'booking.onRefundIssued',
      event: 'RefundIssued',
      version: 1,
      handle: async (e, tx) => {
        await tx.setLocal('atp.scope', 'all');
        await tx.query(
          `UPDATE booking.bookings
              SET refunded_minor = refunded_minor + $2,
                  payment_state = CASE WHEN refunded_minor + $2 >= paid_minor THEN 'refunded' ELSE 'partially_refunded' END,
                  updated_at = now()
            WHERE id = $1 AND paid_minor > 0`,
          [e.payload.bookingId, e.payload.amount.amountMinor],
        );
        await this.touch(tx, 'id', e.payload.bookingId);
      },
    });
    this.bus.subscribe<EventPayload<'PaymentDisputed.v1'>>({
      module: 'booking',
      handler: 'booking.onPaymentDisputed',
      event: 'PaymentDisputed',
      version: 1,
      handle: async (e, tx) => {
        // Visible to support through the audit log and the error stream; resolution is a finance task.
        this.logger.error(`Chargeback on booking ${e.payload.bookingId}`);
        await tx.setLocal('atp.scope', 'all');
        await tx.query(`UPDATE booking.bookings SET updated_at = now() WHERE id = $1`, [
          e.payload.bookingId,
        ]);
      },
    });
  }

  // ---------- Plumbing ----------

  private system<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction('booking', async (tx) => {
      await tx.setLocal('atp.scope', 'all');
      return fn(tx);
    });
  }

  private asAdvisor<T>(advisorId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction('booking', async (tx) => {
      await tx.setLocal('atp.advisor_id', advisorId);
      return fn(tx);
    });
  }

  private lines(tx: Tx, bookingId: string, lock = false): Promise<LineRow[]> {
    return tx.query<LineRow>(
      `${LINE_SELECT} WHERE booking_id = $1 ORDER BY position ${lock ? 'FOR UPDATE' : ''}`,
      [bookingId],
    );
  }

  private async lockBooking(tx: Tx, id: string): Promise<BookingRow> {
    const [b] = await tx.query<BookingRow>(
      `SELECT ${BOOKING_COLUMNS} FROM booking.bookings b WHERE id = $1 FOR UPDATE`,
      [id],
    );
    if (!b) throw problem(HttpStatus.NOT_FOUND, 'not-found', 'Booking not found');
    return b;
  }

  private traveler(b: BookingRow): Traveler | null {
    return b.traveler_enc ? (JSON.parse(this.crypto.decrypt(b.traveler_enc)) as Traveler) : null;
  }

  /** Anonymous link holders are limited per address, like the proposal page. */
  async rateLimit(ip: string): Promise<void> {
    if (this.redis.status === 'wait') await this.redis.connect();
    const key = `rl:checkout:${ip}`;
    const [[, n]] = (await this.redis.multi().incr(key).expire(key, 60, 'NX').exec()) as [
      [unknown, number],
    ];
    if (n > REQUESTS_PER_MINUTE)
      throw problem(HttpStatus.TOO_MANY_REQUESTS, 'rate-limited', 'Too many requests');
  }

  // ---------- Checkout preparation (event) ----------

  private async prepareCheckout(p: EventPayload<'ProposalApproved.v1'>, tx: Tx): Promise<void> {
    if (!p.hotels?.length || !p.tokenHash || !p.linkExpiresAt || !p.currency) return; // nothing to book
    await tx.setLocal('atp.scope', 'all');
    const id = newId();
    const total = p.hotels.reduce((n, h) => n + BigInt(h.total.amountMinor), 0n);
    const inserted = await tx.query(
      `INSERT INTO booking.bookings (id, proposal_id, trip_id, owner_advisor_id, advisor_user_id, trip_title, currency,
                                     total_minor, token_hash, link_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       ON CONFLICT (proposal_id) DO NOTHING RETURNING id`,
      [
        id,
        p.proposalId,
        p.tripId,
        p.advisorId,
        p.advisorUserId,
        p.tripTitle,
        p.currency,
        total,
        p.tokenHash,
        p.linkExpiresAt,
      ],
    );
    if (inserted.length === 0) return; // redelivered
    let position = 0;
    for (const h of p.hotels) {
      position += 1;
      await tx.query(
        `INSERT INTO booking.lines (id, booking_id, owner_advisor_id, item_id, position, supplier, rate_key, property_name,
                                    city, check_in, check_out, nights, room_name, board, adults, children_ages, total_minor,
                                    fees_at_hotel_minor, commissionable_minor, commission_bps, payment_modes, refundable,
                                    free_cancellation_until, cancellation_policy, property_id, rate_codes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`,
        [
          newId(),
          id,
          p.advisorId,
          h.itemId,
          position,
          h.supplier,
          h.rateKey,
          h.propertyName,
          h.city,
          h.checkIn,
          h.checkOut,
          h.nights,
          h.roomName,
          h.board,
          h.adults,
          h.childrenAges,
          h.total.amountMinor,
          h.feesAtHotel.amountMinor,
          h.commissionable.amountMinor,
          h.commissionBps,
          h.paymentModes,
          h.refundable,
          h.freeCancellationUntil,
          h.cancellationPolicy,
          h.propertyId ?? null,
          h.rateCodes ?? [],
        ],
      );
    }
  }

  // ---------- Traveler checkout (FR-BKG-01..03, FR-TRV-03) ----------

  private async findByToken(tx: Tx, token: string, lock = false): Promise<BookingRow> {
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token))
      throw problem(HttpStatus.NOT_FOUND, 'not-found', 'This link is not valid');
    const hash = createHash('sha256').update(token).digest('hex');
    const [b] = await tx.query<BookingRow>(
      `SELECT ${BOOKING_COLUMNS} FROM booking.bookings b WHERE token_hash = $1 ${lock ? 'FOR UPDATE' : ''}`,
      [hash],
    );
    if (!b)
      throw problem(HttpStatus.NOT_FOUND, 'not-found', 'There is nothing to book on this link');
    if (b.link_expires_at <= new Date())
      throw problem(
        HttpStatus.GONE,
        'link-expired',
        'This link has expired',
        'Ask your advisor for a new one.',
      );
    return b;
  }

  private terms(lines: LineRow[]): LineTerms[] {
    return lines.map((l) => ({ totalMinor: BigInt(l.total_minor), paymentModes: l.payment_modes }));
  }

  private checkoutView(b: BookingRow, lines: LineRow[]) {
    const options = paymentOptions(this.terms(lines)).map((o) => ({
      mode: o.mode,
      dueNow: m(o.dueNowMinor, b.currency),
    }));
    const confirmed = b.status === 'confirmed' || b.status === 'completed';
    return {
      status: b.status,
      title: b.trip_title,
      currency: b.currency,
      total: m(b.total_minor, b.currency),
      lines: lines.map((l) => ({
        id: l.id,
        propertyName: l.property_name,
        city: l.city,
        checkIn: l.check_in,
        checkOut: l.check_out,
        nights: l.nights,
        roomName: l.room_name,
        board: l.board,
        total: m(l.total_minor, b.currency),
        feesAtHotel: m(l.fees_at_hotel_minor, b.currency),
        refundable: l.refundable,
        freeCancellationUntil: iso(l.free_cancellation_until),
        cancellationPolicy: l.cancellation_policy,
        status: l.status,
        confirmationCode: confirmed ? l.confirmation_code : null,
      })),
      paymentOptions: options,
      selected: b.payment_mode
        ? { mode: b.payment_mode, dueNow: m(b.due_now_minor, b.currency) }
        : null,
      traveler: this.traveler(b),
      payment: {
        state: b.payment_state,
        amount: b.payment_state === 'none' ? null : m(b.due_now_minor, b.currency),
        clientToken: b.payment_state === 'awaiting' ? b.payment_client_token : null,
        expiresAt: b.payment_state === 'awaiting' ? iso(b.payment_expires_at) : null,
        failure: b.payment_failure,
      },
      failureReason: b.status === 'failed' ? b.failure_reason : null,
      linkExpiresAt: b.link_expires_at.toISOString(),
    };
  }

  async view(token: string) {
    return this.system(async (tx) => {
      const b = await this.findByToken(tx, token);
      return this.checkoutView(b, await this.lines(tx, b.id));
    });
  }

  /**
   * The traveler commits: details and payment choice are stored, prices are re-checked live (FR-BKG-01, AC-03),
   * then either payment is requested (prepay/deposit) or reservation starts at once (pay at hotel).
   */
  async confirm(token: string, input: ConfirmInput, key: string) {
    await this.flags.require('new_bookings', 'bookings-paused', 'Booking is paused for the moment');
    const pre = await this.system(async (tx) => {
      const b = await this.findByToken(tx, token);
      return { b, lines: await this.lines(tx, b.id) };
    });
    const { b } = pre;

    if (b.status !== 'draft') {
      if (b.confirm_key === key) return this.checkoutView(b, pre.lines); // a retry of the same request
      throw problem(
        HttpStatus.CONFLICT,
        'booking-not-open',
        'This booking has already been submitted',
        'Your advisor can tell you where it stands.',
      );
    }
    const awaitingFresh =
      b.payment_state === 'awaiting' &&
      (b.payment_expires_at
        ? b.payment_expires_at > new Date()
        : Date.now() - b.updated_at.getTime() < INTENT_GRACE_MS);
    if (awaitingFresh) {
      if (b.payment_mode === input.paymentMode) return this.checkoutView(b, pre.lines);
      throw problem(
        HttpStatus.CONFLICT,
        'payment-in-progress',
        'A payment is already in progress',
        'Finish it, or wait for it to expire, before choosing a different way to pay.',
      );
    }

    const options = paymentOptions(this.terms(pre.lines));
    const chosen = options.find((o) => o.mode === input.paymentMode);
    if (!chosen)
      throw problem(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'payment-mode-unavailable',
        'That way of paying is not available for this trip',
      );

    const gate = await this.identity.canBook(b.owner_advisor_id);
    if (!gate.allowed)
      throw problem(
        HttpStatus.CONFLICT,
        'booking-not-allowed',
        'Your advisor cannot take this booking yet',
        'Please contact your advisor.',
      );

    await this.revalidate(b, pre.lines, input.paymentMode);

    const traveler: Traveler = {
      name: input.traveler.name,
      email: input.traveler.email,
      phone: input.traveler.phone ?? null,
      specialRequests: input.traveler.specialRequests ?? null,
    };
    await this.system(async (tx) => {
      const cur = await this.lockBooking(tx, b.id);
      if (cur.status !== 'draft') return; // lost a race with a retry: the view below reflects the winner
      const due = chosen.dueNowMinor;
      let status: BookingStatus = 'draft';
      if (due === 0n) status = bookingMachine.next('draft', 'start');
      await tx.query(
        `UPDATE booking.bookings
            SET traveler_enc = $2, payment_mode = $3, due_now_minor = $4, confirm_key = $5, status = $6,
                payment_state = $7, payment_client_token = NULL, payment_expires_at = NULL, payment_failure = NULL,
                pending_since = CASE WHEN $6 = 'pending' THEN now() END, updated_at = now()
          WHERE id = $1`,
        [
          b.id,
          this.crypto.encrypt(JSON.stringify(traveler)),
          input.paymentMode,
          due,
          key,
          status,
          due === 0n ? 'none' : 'awaiting',
        ],
      );
      await this.audit.record({
        actorType: 'user',
        actorId: null,
        action: 'booking.submitted',
        entityType: 'booking',
        entityId: b.id,
        module: 'booking',
        metadata: {
          paymentMode: input.paymentMode,
          dueNowMinor: String(due),
          via: 'traveler_link',
        },
      });
      if (due === 0n) {
        await this.startReservations(tx, b.id);
      } else {
        await tx.publish({
          type: 'BookingPaymentRequested',
          version: 1,
          payload: {
            bookingId: b.id,
            proposalId: b.proposal_id,
            advisorId: b.owner_advisor_id,
            amount: m(due, b.currency),
            description: b.trip_title,
          },
        });
      }
    });
    await this.system((tx) => this.touch(tx, 'id', b.id));
    return this.view(token);
  }

  /** FR-BKG-01: every hotel is priced again with its supplier right now; stale offers are refused (AC-03). */
  private async revalidate(b: BookingRow, lines: LineRow[], mode: PaymentMode): Promise<void> {
    const found: { error: ProblemException | null; stale: string | null } = {
      error: null,
      stale: null,
    };
    const block = (e: ProblemException, stale: string | null) => {
      found.error ??= e;
      found.stale ??= stale;
    };
    await Promise.all(
      lines.map(async (l) => {
        try {
          const r = await this.catalog.checkRate(l.rate_key, b.currency);
          if (!r) {
            const detail = `${l.property_name} cannot be booked for these dates any more.`;
            block(
              problem(
                HttpStatus.CONFLICT,
                'rate-unavailable',
                'A hotel is no longer available',
                `${detail} Your advisor will update your proposal.`,
              ),
              detail,
            );
          } else if (r.rate.total.amountMinor !== l.total_minor) {
            const detail = `The price of ${l.property_name} has changed since the proposal.`;
            block(
              problem(
                HttpStatus.CONFLICT,
                'price-changed',
                'A price has changed',
                `${detail} Your advisor will update it and send it again.`,
              ),
              detail,
            );
          } else if (!r.rate.paymentModes.includes(mode)) {
            block(
              problem(
                HttpStatus.CONFLICT,
                'payment-mode-unavailable',
                'That way of paying is no longer offered for this hotel',
              ),
              `${l.property_name} no longer offers that way of paying.`,
            );
          }
        } catch (e) {
          this.logger.warn(`Rate check failed for ${l.supplier}: ${(e as Error).message}`);
          // A supplier outage is not the advisor's to fix: ask the traveler to retry, do not alert.
          block(
            problem(
              HttpStatus.SERVICE_UNAVAILABLE,
              'supplier-unavailable',
              'We could not confirm availability just now',
              'Please try again in a few minutes.',
            ),
            null,
          );
        }
      }),
    );
    if (found.error) {
      if (found.stale) await this.notifyBlocked(b, found.stale);
      throw found.error;
    }
  }

  /** Tell the advisor once that this booking cannot proceed as proposed (they need to reprice). */
  private async notifyBlocked(b: BookingRow, reason: string): Promise<void> {
    await this.system(async (tx) => {
      const [row] = await tx.query<{ id: string }>(
        `UPDATE booking.bookings SET blocked_notified_at = now()
          WHERE id = $1 AND blocked_notified_at IS NULL AND status = 'draft' RETURNING id`,
        [b.id],
      );
      if (!row) return;
      await this.audit.record({
        actorType: 'system',
        actorId: null,
        action: 'booking.blocked_stale_rate',
        entityType: 'booking',
        entityId: b.id,
        module: 'booking',
        metadata: { reason },
      });
      await tx.publish({
        type: 'BookingBlocked',
        version: 1,
        payload: {
          bookingId: b.id,
          tripId: b.trip_id,
          advisorId: b.owner_advisor_id,
          advisorUserId: b.advisor_user_id,
          tripTitle: b.trip_title,
          reason,
        },
      });
    });
  }

  // ---------- Payment results (events) ----------

  private async onPaymentCaptured(p: EventPayload<'PaymentCaptured.v1'>, tx: Tx): Promise<void> {
    if (!p.bookingId) return;
    await tx.setLocal('atp.scope', 'all');
    const b = await this.lockBooking(tx, p.bookingId);
    if (b.status !== 'draft') {
      this.logger.warn(`Payment ${p.paymentId} captured for booking ${b.id} in status ${b.status}`);
      return;
    }
    bookingMachine.next('draft', 'start');
    await tx.query(
      `UPDATE booking.bookings
          SET status = 'pending', payment_state = 'captured', paid_minor = $2, pending_since = now(),
              payment_client_token = NULL, payment_expires_at = NULL, payment_failure = NULL, updated_at = now()
        WHERE id = $1`,
      [b.id, p.amount.amountMinor],
    );
    await this.startReservations(tx, b.id);
  }

  /** Queue one reserve job per hotel. Each is keyed, so repeating this never queues a second copy. */
  private async startReservations(tx: Tx, bookingId: string): Promise<void> {
    for (const l of await this.lines(tx, bookingId)) {
      if (l.status === 'pending')
        await tx.enqueue('booking.reserve-line', { lineId: l.id }, { jobKey: `reserve:${l.id}` });
    }
  }

  // ---------- Reservation (jobs) ----------

  private async reserveLine(lineId: string, ctx: JobContext): Promise<void> {
    const loaded = await this.system(async (tx) => {
      const [l] = await tx.query<LineRow>(`${LINE_SELECT} WHERE id = $1`, [lineId]);
      if (!l) return null;
      const [b] = await tx.query<BookingRow>(
        `SELECT ${BOOKING_COLUMNS} FROM booking.bookings b WHERE id = $1`,
        [l.booking_id],
      );
      return { l, b: b! };
    });
    if (!loaded || loaded.l.status !== 'pending') return;
    const { l, b } = loaded;
    if (b.status !== 'pending') {
      // The booking failed or was dropped while this job waited: never reserve for it.
      await this.system(async (tx) => {
        await tx.query(
          `UPDATE booking.lines SET status = 'cancelled', updated_at = now() WHERE id = $1 AND status = 'pending'`,
          [l.id],
        );
      });
      return;
    }
    const guest = this.traveler(b);
    if (!guest) throw new Error(`Booking ${b.id} has no traveler details`);

    type Outcome =
      | { status: 'confirmed'; ref: string; code: string; raw: unknown }
      | { status: 'rejected'; reason: string; raw: unknown };
    let outcome: Outcome;
    try {
      const r = await this.catalog.reserve(l.rate_key, {
        currency: b.currency,
        expectedTotal: m(l.total_minor, b.currency),
        occupancy: { adults: l.adults, childrenAges: l.children_ages },
        guest: {
          name: guest.name,
          email: guest.email,
          phone: guest.phone,
          specialRequests: guest.specialRequests,
        },
        idempotencyKey: `${b.id}:${l.id}`,
      });
      outcome =
        r.status === 'confirmed'
          ? { status: 'confirmed', ref: r.reservationRef, code: r.confirmationCode, raw: r.raw }
          : { status: 'rejected', reason: r.reason, raw: r.raw };
    } catch (e) {
      await this.system((tx) =>
        tx.query(
          `UPDATE booking.lines SET attempts = attempts + 1, updated_at = now() WHERE id = $1`,
          [l.id],
        ),
      );
      if (ctx.attempts < ctx.maxAttempts) throw e; // retried with backoff, same idempotency key
      outcome = {
        status: 'rejected',
        reason: 'supplier_unavailable',
        raw: { error: (e as Error).message },
      };
    }

    await this.system(async (tx) => {
      const booking = await this.lockBooking(tx, b.id);
      const [cur] = await tx.query<LineRow>(`${LINE_SELECT} WHERE id = $1 FOR UPDATE`, [l.id]);
      if (!cur || cur.status !== 'pending') return;
      if (outcome.status === 'confirmed') {
        await tx.query(
          `UPDATE booking.lines SET status = 'confirmed', supplier_ref = $2, confirmation_code = $3,
                  supplier_response = $4, updated_at = now() WHERE id = $1`,
          [l.id, outcome.ref, outcome.code, JSON.stringify(outcome.raw)],
        );
      } else {
        await tx.query(
          `UPDATE booking.lines SET status = 'failed', failure_reason = $2, supplier_response = $3, updated_at = now()
            WHERE id = $1`,
          [l.id, outcome.reason, JSON.stringify(outcome.raw)],
        );
      }
      await this.evaluate(tx, booking.id);
    });
  }

  private async cancelLine(lineId: string): Promise<void> {
    const l = await this.system(async (tx) => {
      const [row] = await tx.query<LineRow>(`${LINE_SELECT} WHERE id = $1`, [lineId]);
      return row ?? null;
    });
    if (!l || l.status !== 'confirmed' || !l.supplier_ref) return;
    const result = await this.catalog.cancelReservation(l.supplier_ref, `${l.id}:cancel`);
    await this.system(async (tx) => {
      const booking = await this.lockBooking(tx, l.booking_id);
      const updated = await tx.query(
        `UPDATE booking.lines SET status = 'cancelled', penalty_minor = $2, supplier_response = coalesce(supplier_response, '{}'::jsonb) || $3::jsonb,
                updated_at = now()
          WHERE id = $1 AND status = 'confirmed' RETURNING id`,
        [l.id, result.penalty.amountMinor, JSON.stringify({ cancellation: result.raw })],
      );
      if (updated.length === 0) return;
      if (booking.status === 'failed' && BigInt(result.penalty.amountMinor) > 0n) {
        // The traveler is made whole by the refund; this cost stays with the platform and finance should see it.
        this.logger.error(
          `Compensating cancel of ${l.property_name} cost ${result.penalty.amountMinor} ${result.penalty.currency}`,
        );
        await this.audit.record({
          actorType: 'system',
          actorId: null,
          action: 'booking.compensation_penalty',
          entityType: 'booking',
          entityId: booking.id,
          module: 'booking',
          metadata: { lineId: l.id, penalty: result.penalty },
        });
      }
      await this.evaluate(tx, booking.id);
    });
  }

  /**
   * Decide what a booking becomes after any hotel changes. All confirmed -> confirmed. Any refused -> failed, and
   * hotels already confirmed are cancelled again (compensation). All cancelled after a request -> cancelled.
   */
  private async evaluate(tx: Tx, bookingId: string): Promise<void> {
    await this.evaluateInner(tx, bookingId);
    await this.touch(tx, 'id', bookingId);
  }

  /** Announce a change so the advisor's live stream can refresh (delivered after commit, via the outbox). */
  private async touch(tx: Tx, column: 'id' | 'proposal_id', value: string): Promise<void> {
    await tx.setLocal('atp.scope', 'all');
    const [b] = await tx.query<{
      id: string;
      trip_id: string;
      owner_advisor_id: string;
      status: string;
    }>(`SELECT id, trip_id, owner_advisor_id, status FROM booking.bookings WHERE ${column} = $1`, [
      value,
    ]);
    if (!b) return;
    await tx.publish({
      type: 'BookingUpdated',
      version: 1,
      payload: {
        bookingId: b.id,
        tripId: b.trip_id,
        advisorId: b.owner_advisor_id,
        status: b.status,
      },
    });
  }

  private async evaluateInner(tx: Tx, bookingId: string): Promise<void> {
    const b = await this.lockBooking(tx, bookingId);
    const lines = await this.lines(tx, bookingId);
    const traveler = this.traveler(b);
    const who = {
      advisorUserId: b.advisor_user_id,
      tripTitle: b.trip_title,
      ...(traveler ? { travelerName: traveler.name, travelerEmail: traveler.email } : {}),
    };

    if (b.status === 'pending') {
      const failed = lines.find((l) => l.status === 'failed');
      if (failed) {
        const next = bookingMachine.next('pending', 'fail');
        const reason = `${failed.property_name}: ${humanReason(failed.failure_reason)}`;
        await tx.query(
          `UPDATE booking.bookings SET status = $2, failure_reason = $3, updated_at = now() WHERE id = $1`,
          [b.id, next, reason],
        );
        for (const l of lines) {
          if (l.status === 'pending')
            await tx.query(
              `UPDATE booking.lines SET status = 'cancelled', updated_at = now() WHERE id = $1`,
              [l.id],
            );
          if (l.status === 'confirmed')
            await tx.enqueue('booking.cancel-line', { lineId: l.id }, { jobKey: `cancel:${l.id}` });
        }
        await this.audit.record({
          actorType: 'system',
          actorId: null,
          action: 'booking.failed',
          entityType: 'booking',
          entityId: b.id,
          module: 'booking',
          metadata: { reason },
        });
        await tx.publish({
          type: 'BookingFailed',
          version: 1,
          payload: {
            bookingId: b.id,
            tripId: b.trip_id,
            advisorId: b.owner_advisor_id,
            reason,
            ...who,
          },
        });
        return;
      }
      if (lines.every((l) => l.status === 'confirmed')) {
        const next = bookingMachine.next('pending', 'confirm');
        await tx.query(
          `UPDATE booking.bookings SET status = $2, confirmed_at = now(), updated_at = now() WHERE id = $1`,
          [b.id, next],
        );
        await this.audit.record({
          actorType: 'system',
          actorId: null,
          action: 'booking.confirmed',
          entityType: 'booking',
          entityId: b.id,
          module: 'booking',
          metadata: { confirmations: lines.map((l) => l.confirmation_code) },
        });
        await tx.publish({
          type: 'BookingConfirmed',
          version: 1,
          payload: {
            bookingId: b.id,
            tripId: b.trip_id,
            advisorId: b.owner_advisor_id,
            total: m(b.total_minor, b.currency),
            lines: lines.map((l) => ({
              lineId: l.id,
              ...(l.property_id ? { propertyId: l.property_id } : {}),
              rateCodes: l.rate_codes,
              supplier: l.supplier,
              propertyName: l.property_name,
              checkIn: l.check_in,
              checkOut: l.check_out,
              confirmationCode: l.confirmation_code ?? '',
              total: m(l.total_minor, b.currency),
              commissionable: m(l.commissionable_minor, b.currency),
              commissionBps: l.commission_bps,
            })),
            ...who,
          },
        });
      }
      return;
    }

    if (b.status === 'failed') {
      // A hotel confirmed after the booking had already failed: undo it.
      for (const l of lines)
        if (l.status === 'confirmed')
          await tx.enqueue('booking.cancel-line', { lineId: l.id }, { jobKey: `cancel:${l.id}` });
      return;
    }

    if (b.status === 'modified' && !b.cancel_requested_at) {
      const open = lines.filter(
        (l) => l.status === 'confirmed' && l.guest_version !== b.guest_version && !l.amend_failed,
      );
      if (open.length > 0) return; // hotels still to answer
      const refused = lines.filter((l) => l.amend_failed);
      const next = bookingMachine.next('modified', 'reconfirm');
      await tx.query(`UPDATE booking.bookings SET status = $2, updated_at = now() WHERE id = $1`, [
        b.id,
        next,
      ]);
      await this.audit.record({
        actorType: 'system',
        actorId: null,
        action: refused.length ? 'booking.modification_failed' : 'booking.modified',
        entityType: 'booking',
        entityId: b.id,
        module: 'booking',
        metadata: { refused: refused.map((l) => l.property_name) },
      });
      if (refused.length) {
        await tx.publish({
          type: 'BookingModificationFailed',
          version: 1,
          payload: {
            bookingId: b.id,
            tripId: b.trip_id,
            advisorId: b.owner_advisor_id,
            advisorUserId: b.advisor_user_id,
            tripTitle: b.trip_title,
            hotels: refused.map((l) => l.property_name),
          },
        });
      } else if (traveler) {
        await tx.publish({
          type: 'BookingModified',
          version: 1,
          payload: {
            bookingId: b.id,
            tripId: b.trip_id,
            advisorId: b.owner_advisor_id,
            advisorUserId: b.advisor_user_id,
            tripTitle: b.trip_title,
            travelerName: traveler.name,
            travelerEmail: traveler.email,
          },
        });
      }
      return;
    }

    if (b.cancel_requested_at && bookingMachine.can(b.status, 'cancel')) {
      if (lines.some((l) => l.status === 'confirmed')) return; // still waiting on a supplier
      const penalty = lines.reduce((n, l) => n + BigInt(l.penalty_minor), 0n);
      const refund = refundAfterPenalty(BigInt(b.paid_minor), penalty);
      const next = bookingMachine.next(b.status, 'cancel');
      await tx.query(
        `UPDATE booking.bookings SET status = $2, penalty_minor = $3, cancelled_at = now(), updated_at = now() WHERE id = $1`,
        [b.id, next, penalty],
      );
      await this.audit.record({
        actorType: 'system',
        actorId: null,
        action: 'booking.cancelled',
        entityType: 'booking',
        entityId: b.id,
        module: 'booking',
        metadata: { penaltyMinor: String(penalty), refundMinor: String(refund) },
      });
      await tx.publish({
        type: 'BookingCancelled',
        version: 1,
        payload: {
          bookingId: b.id,
          tripId: b.trip_id,
          advisorId: b.owner_advisor_id,
          penalty: m(penalty, b.currency),
          refund: m(refund, b.currency),
          ...who,
        },
      });
    }
  }

  // ---------- Advisor: view, cancel (FR-BKG-05) ----------

  private advisorView(b: BookingRow, lines: LineRow[]) {
    const cur = b.currency;
    return {
      id: b.id,
      tripId: b.trip_id,
      proposalId: b.proposal_id,
      tripTitle: b.trip_title,
      status: b.status,
      modifying: b.status === 'modified',
      cancelling:
        b.cancel_requested_at !== null && (b.status === 'confirmed' || b.status === 'modified'),
      currency: cur,
      paymentMode: b.payment_mode,
      total: m(b.total_minor, cur),
      dueNow: m(b.due_now_minor, cur),
      paid: m(b.paid_minor, cur),
      refunded: m(b.refunded_minor, cur),
      penalty: m(b.penalty_minor, cur),
      paymentState: b.payment_state,
      traveler: this.traveler(b),
      lines: lines.map((l) => ({
        ...this.checkoutView(b, [l]).lines[0]!,
        confirmationCode: l.confirmation_code,
        supplier: l.supplier,
        commissionable: m(l.commissionable_minor, cur),
        commissionBps: l.commission_bps,
        penalty: m(l.penalty_minor, cur),
        attempts: l.attempts,
        failureReason: l.failure_reason,
        guestDetailsSent: l.guest_version === b.guest_version && !l.amend_failed,
        guestDetailsRefused: l.amend_failed,
      })),
      failureReason: b.failure_reason,
      createdAt: b.created_at.toISOString(),
      confirmedAt: iso(b.confirmed_at),
      cancelledAt: iso(b.cancelled_at),
    };
  }

  async list(advisorId: string, q: { tripId?: string | undefined; status?: string | undefined }) {
    return this.asAdvisor(advisorId, async (tx) => {
      const rows = await tx.query<BookingRow>(
        `SELECT ${BOOKING_COLUMNS} FROM booking.bookings b
          WHERE owner_advisor_id = $1 AND ($2::uuid IS NULL OR trip_id = $2) AND ($3::text IS NULL OR status = $3)
          ORDER BY created_at DESC LIMIT 200`,
        [advisorId, q.tripId ?? null, q.status ?? null],
      );
      const items = [];
      for (const b of rows) items.push(this.advisorView(b, await this.lines(tx, b.id)));
      return { items };
    });
  }

  private async loadOwned(
    tx: Tx,
    advisorId: string,
    id: string,
    lock = false,
  ): Promise<BookingRow> {
    const [b] = await tx.query<BookingRow>(
      `SELECT ${BOOKING_COLUMNS} FROM booking.bookings b WHERE id = $1 AND owner_advisor_id = $2 ${lock ? 'FOR UPDATE' : ''}`,
      [id, advisorId],
    );
    if (!b) throw problem(HttpStatus.NOT_FOUND, 'not-found', 'Booking not found');
    return b;
  }

  async get(advisorId: string, id: string) {
    return this.asAdvisor(advisorId, async (tx) => {
      const b = await this.loadOwned(tx, advisorId, id);
      return this.advisorView(b, await this.lines(tx, id));
    });
  }

  /** What cancelling would cost now, from the rate terms (the supplier confirms the real figure). */
  async cancellationQuote(advisorId: string, id: string) {
    return this.asAdvisor(advisorId, async (tx) => {
      const b = await this.loadOwned(tx, advisorId, id);
      if (!bookingMachine.can(b.status, 'cancel'))
        throw problem(
          HttpStatus.CONFLICT,
          'booking-not-cancellable',
          `A ${b.status} booking cannot be cancelled`,
        );
      const now = new Date();
      const lines = (await this.lines(tx, id)).filter((l) => l.status === 'confirmed');
      const quoted = lines.map((l) => ({
        l,
        penalty: cancellationPenalty(
          {
            totalMinor: BigInt(l.total_minor),
            nights: l.nights,
            refundable: l.refundable,
            freeCancellationUntil: l.free_cancellation_until,
          },
          now,
        ),
      }));
      const penalty = quoted.reduce((n, q) => n + q.penalty, 0n);
      return {
        bookingId: b.id,
        estimate: true as const,
        lines: quoted.map(({ l, penalty: p }) => ({
          id: l.id,
          propertyName: l.property_name,
          total: m(l.total_minor, b.currency),
          penalty: m(p, b.currency),
          freeCancellationUntil: iso(l.free_cancellation_until),
          cancellationPolicy: l.cancellation_policy,
        })),
        penalty: m(penalty, b.currency),
        paid: m(b.paid_minor, b.currency),
        refund: m(refundAfterPenalty(BigInt(b.paid_minor), penalty), b.currency),
      };
    });
  }

  /** Cancellation is asynchronous: suppliers are asked from jobs and the refund follows their answer. */
  async cancel(advisorId: string, id: string, reason: string) {
    await this.asAdvisor(advisorId, async (tx) => {
      const b = await this.loadOwned(tx, advisorId, id, true);
      if (b.cancel_requested_at && (b.status === 'confirmed' || b.status === 'modified')) return;
      if (!bookingMachine.can(b.status, 'cancel'))
        throw problem(
          HttpStatus.CONFLICT,
          'booking-not-cancellable',
          `A ${b.status} booking cannot be cancelled`,
        );
      await tx.query(
        `UPDATE booking.bookings SET cancel_requested_at = now(), cancel_reason = $2, updated_at = now() WHERE id = $1`,
        [id, reason],
      );
      await this.audit.record({
        actorType: 'user',
        action: 'booking.cancel_requested',
        entityType: 'booking',
        entityId: id,
        module: 'booking',
        metadata: { reason },
      });
      for (const l of await this.lines(tx, id))
        if (l.status === 'confirmed')
          await tx.enqueue('booking.cancel-line', { lineId: l.id }, { jobKey: `cancel:${l.id}` });
      await this.touch(tx, 'id', id);
    });
    return this.get(advisorId, id);
  }

  /**
   * The traveler cannot go ahead (a price moved, a hotel sold out) or the advisor wants to change the plan: drop
   * the unpaid draft so the trip can be edited and proposed again. Only drafts: anything paid goes through cancel.
   */
  async discardDraft(advisorId: string, id: string) {
    await this.asAdvisor(advisorId, async (tx) => {
      const b = await this.loadOwned(tx, advisorId, id, true);
      if (b.status !== 'draft')
        throw problem(
          HttpStatus.CONFLICT,
          'booking-not-draft',
          'Only a booking the traveler has not submitted can be discarded',
          'Cancel it instead.',
        );
      await tx.publish({
        type: 'BookingUpdated',
        version: 1,
        payload: {
          bookingId: id,
          tripId: b.trip_id,
          advisorId: b.owner_advisor_id,
          status: 'discarded',
        },
      });
      await tx.query('DELETE FROM booking.lines WHERE booking_id = $1', [id]);
      await tx.query('DELETE FROM booking.bookings WHERE id = $1', [id]);
      await this.audit.record({
        actorType: 'user',
        action: 'booking.discarded',
        entityType: 'booking',
        entityId: id,
        module: 'booking',
        metadata: { tripId: b.trip_id },
      });
      await tx.publish({
        type: 'BookingDiscarded',
        version: 1,
        payload: {
          bookingId: id,
          tripId: b.trip_id,
          proposalId: b.proposal_id,
          advisorId: b.owner_advisor_id,
        },
      });
    });
  }

  /**
   * Change the lead guest or requests on a confirmed booking (FR-BKG-05). Our record changes at once; each hotel
   * is told from its own job. When every hotel has answered the booking is confirmed again; hotels that refuse
   * are flagged for the advisor to settle directly.
   */
  async modifyGuest(
    advisorId: string,
    id: string,
    changes: {
      name?: string | undefined;
      email?: string | undefined;
      phone?: string | null | undefined;
      specialRequests?: string | null | undefined;
    },
  ) {
    await this.asAdvisor(advisorId, async (tx) => {
      const b = await this.loadOwned(tx, advisorId, id, true);
      if (!bookingMachine.can(b.status, 'modify') || b.cancel_requested_at)
        throw problem(
          HttpStatus.CONFLICT,
          'booking-not-modifiable',
          `A ${b.cancel_requested_at ? 'cancelling' : b.status} booking cannot be changed`,
          'Only a confirmed booking can be changed, one change at a time.',
        );
      const cur = this.traveler(b);
      if (!cur)
        throw problem(HttpStatus.CONFLICT, 'booking-not-modifiable', 'No guest details yet');
      const next: Traveler = {
        name: changes.name ?? cur.name,
        email: changes.email ?? cur.email,
        phone: changes.phone === undefined ? cur.phone : changes.phone,
        specialRequests:
          changes.specialRequests === undefined ? cur.specialRequests : changes.specialRequests,
      };
      if (JSON.stringify(next) === JSON.stringify(cur))
        throw problem(HttpStatus.UNPROCESSABLE_ENTITY, 'nothing-to-change', 'Nothing was changed');
      const version = b.guest_version + 1;
      await tx.query(
        `UPDATE booking.bookings SET traveler_enc = $2, guest_version = $3, status = $4, updated_at = now() WHERE id = $1`,
        [
          id,
          this.crypto.encrypt(JSON.stringify(next)),
          version,
          bookingMachine.next(b.status, 'modify'),
        ],
      );
      await tx.query(`UPDATE booking.lines SET amend_failed = false WHERE booking_id = $1`, [id]);
      await this.audit.record({
        actorType: 'user',
        action: 'booking.modify_requested',
        entityType: 'booking',
        entityId: id,
        module: 'booking',
        metadata: { fields: Object.keys(changes) },
      });
      for (const l of await this.lines(tx, id))
        if (l.status === 'confirmed')
          await tx.enqueue(
            'booking.amend-line',
            { lineId: l.id, version },
            { jobKey: `amend:${l.id}:${version}` },
          );
      await this.touch(tx, 'id', id);
    });
    return this.get(advisorId, id);
  }

  private async amendLine(lineId: string, version: number, ctx: JobContext): Promise<void> {
    const loaded = await this.system(async (tx) => {
      const [l] = await tx.query<LineRow>(`${LINE_SELECT} WHERE id = $1`, [lineId]);
      if (!l) return null;
      const [b] = await tx.query<BookingRow>(
        `SELECT ${BOOKING_COLUMNS} FROM booking.bookings b WHERE id = $1`,
        [l.booking_id],
      );
      return { l, b: b! };
    });
    if (!loaded) return;
    const { l, b } = loaded;
    if (
      b.status !== 'modified' ||
      b.guest_version !== version ||
      l.status !== 'confirmed' ||
      l.guest_version >= version ||
      !l.supplier_ref
    )
      return; // superseded by a newer change, cancelled, or already done
    const guest = this.traveler(b)!;
    let ok: boolean;
    try {
      const r = await this.catalog.amendReservation(
        l.supplier_ref,
        {
          name: guest.name,
          email: guest.email,
          phone: guest.phone,
          specialRequests: guest.specialRequests,
        },
        `${l.id}:amend:${version}`,
      );
      ok = r.status === 'amended';
    } catch (e) {
      if (ctx.attempts < ctx.maxAttempts) throw e;
      ok = false;
    }
    await this.system(async (tx) => {
      const booking = await this.lockBooking(tx, b.id);
      if (booking.guest_version !== version) return;
      if (ok)
        await tx.query(
          `UPDATE booking.lines SET guest_version = $2, updated_at = now() WHERE id = $1`,
          [l.id, version],
        );
      else
        await tx.query(
          `UPDATE booking.lines SET amend_failed = true, updated_at = now() WHERE id = $1`,
          [l.id],
        );
      await this.evaluate(tx, b.id);
    });
  }

  // ---------- Admin: advisor leaves (FR-ADM-02) ----------

  private static readonly OPEN = `(b.status IN ('draft', 'pending') OR (b.status IN ('confirmed', 'modified')
      AND EXISTS (SELECT 1 FROM booking.lines l WHERE l.booking_id = b.id AND l.status = 'confirmed' AND l.check_out >= current_date)))`;

  /** Bookings that still need someone: not yet submitted, in progress, or confirmed with a stay to come. */
  async openCount(advisorId: string): Promise<number> {
    return this.system(async (tx) => {
      const [r] = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM booking.bookings b WHERE b.owner_advisor_id = $1 AND ${BookingService.OPEN}`,
        [advisorId],
      );
      return r!.n;
    });
  }

  /**
   * Move an advisor's open bookings to another advisor. Commission already earned stays with whoever earned it.
   * Trips and clients follow by event. Safe to repeat: only bookings still owned by `from` move.
   */
  async reassignOpen(from: string, to: { advisorId: string; userId: string }, actorId: string) {
    return this.system(async (tx) => {
      const moved = await tx.query<{ id: string; trip_id: string }>(
        `UPDATE booking.bookings b SET owner_advisor_id = $2, advisor_user_id = $3, updated_at = now()
          WHERE b.owner_advisor_id = $1 AND ${BookingService.OPEN} RETURNING b.id, b.trip_id`,
        [from, to.advisorId, to.userId],
      );
      if (moved.length === 0) return { bookingIds: [] as string[], tripIds: [] as string[] };
      const ids = moved.map((m) => m.id);
      await tx.query(
        `UPDATE booking.lines SET owner_advisor_id = $2 WHERE booking_id = ANY($1::uuid[])`,
        [ids, to.advisorId],
      );
      const tripIds = [...new Set(moved.map((m) => m.trip_id))];
      await this.audit.record({
        actorType: 'user',
        actorId,
        action: 'booking.reassigned',
        entityType: 'advisor',
        entityId: from,
        module: 'booking',
        metadata: { toAdvisorId: to.advisorId, bookingIds: ids },
      });
      await tx.publish({
        type: 'AdvisorBookingsReassigned',
        version: 1,
        payload: {
          fromAdvisorId: from,
          toAdvisorId: to.advisorId,
          toAdvisorUserId: to.userId,
          bookingIds: ids,
          tripIds,
        },
      });
      for (const id of ids) await this.touch(tx, 'id', id);
      return { bookingIds: ids, tripIds };
    });
  }

  // ---------- Support: stuck bookings (FRD "stuck Pending alert + support queue") ----------

  async stuck(minutes = STUCK_AFTER_MINUTES) {
    return this.system(async (tx) => {
      const rows = await tx.query<BookingRow>(
        `SELECT ${BOOKING_COLUMNS} FROM booking.bookings b
          WHERE status = 'pending' AND pending_since < now() - make_interval(mins => $1)
          ORDER BY pending_since LIMIT 200`,
        [minutes],
      );
      const items = [];
      for (const b of rows) {
        const lines = await this.lines(tx, b.id);
        items.push({
          id: b.id,
          tripTitle: b.trip_title,
          pendingSince: b.pending_since!.toISOString(),
          lines: lines.map((l) => ({
            id: l.id,
            propertyName: l.property_name,
            supplier: l.supplier,
            status: l.status,
            attempts: l.attempts,
          })),
        });
      }
      return { items };
    });
  }

  /** Support nudges a stuck booking: its unfinished hotels are queued again with the same keys. */
  async retryStuck(id: string, actorId: string) {
    await this.system(async (tx) => {
      const b = await this.lockBooking(tx, id);
      if (b.status !== 'pending')
        throw problem(HttpStatus.CONFLICT, 'booking-not-pending', 'This booking is not pending');
      for (const l of await this.lines(tx, id))
        if (l.status === 'pending')
          await tx.enqueue('booking.reserve-line', { lineId: l.id }, { jobKey: `reserve:${l.id}` });
      await this.audit.record({
        actorType: 'user',
        actorId,
        action: 'booking.retry_requested',
        entityType: 'booking',
        entityId: id,
        module: 'booking',
      });
    });
  }

  private async alertStuck(): Promise<void> {
    const { items } = await this.stuck();
    for (const b of items)
      this.logger.error(
        `Booking ${b.id} has been pending since ${b.pendingSince} (${b.lines.filter((l) => l.status === 'pending').length} hotel(s) unconfirmed)`,
      );
  }

  /** Daily: bookings whose last check-out has passed become completed (FRD: Confirmed -> Completed). */
  private async completeStays(): Promise<void> {
    await this.system(async (tx) => {
      const rows = await tx.query<{ id: string; owner_advisor_id: string }>(
        `SELECT b.id, b.owner_advisor_id FROM booking.bookings b
          WHERE b.status = 'confirmed'
            AND NOT EXISTS (SELECT 1 FROM booking.lines l WHERE l.booking_id = b.id AND l.status = 'confirmed' AND l.check_out >= current_date)
            AND EXISTS (SELECT 1 FROM booking.lines l WHERE l.booking_id = b.id AND l.status = 'confirmed')
          FOR UPDATE`,
      );
      for (const r of rows) {
        const next = bookingMachine.next('confirmed', 'complete');
        await tx.query(
          `UPDATE booking.bookings SET status = $2, completed_at = now(), updated_at = now() WHERE id = $1`,
          [r.id, next],
        );
        await tx.publish({
          type: 'BookingCompleted',
          version: 1,
          payload: { bookingId: r.id, advisorId: r.owner_advisor_id },
        });
        await this.touch(tx, 'id', r.id);
      }
    });
  }
}

function humanReason(code: string | null): string {
  switch (code) {
    case 'sold_out':
      return 'no longer available';
    case 'price_changed':
      return 'the price changed';
    case 'supplier_unavailable':
      return 'the hotel supplier could not be reached';
    default:
      return 'the booking was refused';
  }
}

/** Re-exported for tests that need to compute expectations the same way. */
export { dueNow };
