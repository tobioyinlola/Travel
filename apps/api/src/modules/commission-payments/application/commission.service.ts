import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import type { EventPayload } from '@atp/contracts';
import { AuditWriter } from '../../../platform/audit/audit-writer.js';
import { Database } from '../../../platform/db/database.js';
import type { Tx } from '../../../platform/db/tx.js';
import { EventBus } from '../../../platform/events/event-bus.js';
import { ProblemException, problemType } from '../../../platform/http/problem.js';
import { MembershipApi } from '../../membership/index.js';
import { newId } from '../../shared-kernel/index.js';
import { splitCommission } from '../domain/split.js';

const problem = (status: HttpStatus, slug: string, title: string, detail?: string) =>
  new ProblemException(status, problemType(slug), title, detail);

type Dir = 'debit' | 'credit';
interface Entry {
  account: string;
  direction: Dir;
  amountMinor: bigint;
  advisorId?: string;
}

interface CommissionRow {
  id: string;
  booking_id: string;
  line_id: string;
  advisor_id: string;
  supplier: string;
  property_name: string;
  check_in: string;
  check_out: string;
  currency: string;
  commissionable_minor: string;
  rate_bps: number;
  expected_minor: string;
  tier_code: string;
  advisor_share_bps: number;
  advisor_minor: string;
  platform_minor: string;
  status: string;
  reversal_reason: string | null;
  recognized_at: Date;
  released_at: Date | null;
}

const SELECT = `SELECT id, booking_id, line_id, advisor_id, supplier, property_name,
  to_char(check_in, 'YYYY-MM-DD') AS check_in, to_char(check_out, 'YYYY-MM-DD') AS check_out, currency,
  commissionable_minor, rate_bps, expected_minor, tier_code, advisor_share_bps, advisor_minor, platform_minor,
  status, reversal_reason, recognized_at, released_at FROM commission.commissions`;

const m = (minor: string | bigint, currency: string) => ({ amountMinor: String(minor), currency });

/**
 * Commission recognition, release and reversal, each posted to the double-entry ledger (FR-COM-01..03, 05, 06).
 *
 * Recognition happens when the booking is confirmed. The advisor's share is only *payable* once the supplier has
 * paid us (FR-COM-05, decision D6): until then it sits in `advisor_commission_pending`. In Sprint 6 a finance user
 * records the supplier payment by hand; Sprint 7 replaces that with statement import and reconciliation.
 */
@Injectable()
export class CommissionService implements OnModuleInit {
  constructor(
    private readonly db: Database,
    private readonly bus: EventBus,
    private readonly audit: AuditWriter,
    private readonly membership: MembershipApi,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe<EventPayload<'BookingConfirmed.v1'>>({
      module: 'commission-payments',
      handler: 'commission.recognizeOnConfirmation',
      event: 'BookingConfirmed',
      version: 1,
      queue: 'critical',
      handle: (e, tx) => this.recognize(e.payload, e.occurredAt, tx),
    });
    this.bus.subscribe<EventPayload<'BookingCancelled.v1'>>({
      module: 'commission-payments',
      handler: 'commission.reverseOnCancellation',
      event: 'BookingCancelled',
      version: 1,
      queue: 'critical',
      handle: (e, tx) => this.reverseBooking(tx, e.payload.bookingId, 'booking_cancelled'),
    });
  }

  // ---------- Ledger ----------

  /** Post one balanced transaction. Returns false when this cause was already posted (idempotent). */
  private async post(
    tx: Tx,
    t: {
      kind: string;
      refType: string;
      refId: string;
      description: string;
      currency: string;
      entries: Entry[];
    },
  ): Promise<boolean> {
    const id = newId();
    const inserted = await tx.query(
      `INSERT INTO commission.ledger_txns (id, kind, ref_type, ref_id, description, currency)
       VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (kind, ref_type, ref_id) DO NOTHING RETURNING id`,
      [id, t.kind, t.refType, t.refId, t.description, t.currency],
    );
    if (inserted.length === 0) return false;
    for (const e of t.entries) {
      if (e.amountMinor <= 0n) continue;
      await tx.query(
        `INSERT INTO commission.ledger_entries (txn_id, account, advisor_id, direction, amount_minor, currency)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, e.account, e.advisorId ?? null, e.direction, e.amountMinor, t.currency],
      );
    }
    return true;
  }

  // ---------- Recognition (FR-COM-01, 02) ----------

  private async recognize(
    p: EventPayload<'BookingConfirmed.v1'>,
    occurredAt: string | Date,
    tx: Tx,
  ): Promise<void> {
    await tx.setLocal('atp.scope', 'all');
    for (const l of p.lines ?? []) {
      if (!l.lineId || l.commissionBps <= 0) continue;
      const currency = l.commissionable.currency;
      // The tier now applies to this sale; any upgrade it causes applies to later sales (AC-06).
      const split = await this.membership.splitFor(p.advisorId, currency);
      const s = splitCommission({
        commissionableMinor: BigInt(l.commissionable.amountMinor),
        rateBps: l.commissionBps,
        advisorShareBps: split.advisorShareBps,
      });
      if (s.expectedMinor === 0n) continue;
      const id = newId();
      const inserted = await tx.query(
        `INSERT INTO commission.commissions (id, booking_id, line_id, advisor_id, supplier, property_name, check_in, check_out,
            currency, commissionable_minor, rate_bps, expected_minor, tier_code, advisor_share_bps, advisor_minor,
            platform_minor, recognized_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (line_id) DO NOTHING RETURNING id`,
        [
          id,
          p.bookingId,
          l.lineId,
          p.advisorId,
          l.supplier,
          l.propertyName,
          l.checkIn,
          l.checkOut,
          currency,
          l.commissionable.amountMinor,
          l.commissionBps,
          s.expectedMinor,
          split.tierCode,
          split.advisorShareBps,
          s.advisorMinor,
          s.platformMinor,
          occurredAt,
        ],
      );
      if (inserted.length === 0) continue; // redelivered
      await this.post(tx, {
        kind: 'recognition',
        refType: 'commission',
        refId: id,
        description: `Commission on ${l.propertyName}`,
        currency,
        entries: [
          { account: 'supplier_receivable', direction: 'debit', amountMinor: s.expectedMinor },
          { account: 'platform_revenue', direction: 'credit', amountMinor: s.platformMinor },
          {
            account: 'advisor_commission_pending',
            direction: 'credit',
            amountMinor: s.advisorMinor,
            advisorId: p.advisorId,
          },
        ],
      });
      await tx.publish({
        type: 'CommissionRecognized',
        version: 1,
        payload: {
          commissionId: id,
          bookingId: p.bookingId,
          advisorId: p.advisorId,
          supplier: l.supplier,
          commissionable: l.commissionable,
          expected: m(s.expectedMinor, currency),
          advisorShare: m(s.advisorMinor, currency),
          platformShare: m(s.platformMinor, currency),
          advisorShareBps: split.advisorShareBps,
          tierCode: split.tierCode,
          recognizedAt: new Date(occurredAt).toISOString(),
        },
      });
    }
  }

  // ---------- Release (FR-COM-05) ----------

  /** The supplier has paid this commission: the advisor's share becomes payable. */
  async release(id: string, actorId: string) {
    return this.db.transaction('commission-payments', async (tx) => {
      await tx.setLocal('atp.scope', 'all');
      const [c] = await tx.query<CommissionRow>(`${SELECT} WHERE id = $1 FOR UPDATE`, [id]);
      if (!c) throw problem(HttpStatus.NOT_FOUND, 'not-found', 'Commission not found');
      if (c.status !== 'expected' && c.status !== 'received' && c.status !== 'reconciled')
        throw problem(
          HttpStatus.CONFLICT,
          'commission-not-releasable',
          `A ${c.status} commission cannot be released`,
        );
      const expected = BigInt(c.expected_minor);
      const advisor = BigInt(c.advisor_minor);
      await this.post(tx, {
        kind: 'release',
        refType: 'commission',
        refId: c.id,
        description: `Supplier paid commission on ${c.property_name}`,
        currency: c.currency,
        entries: [
          { account: 'cash_clearing', direction: 'debit', amountMinor: expected },
          { account: 'supplier_receivable', direction: 'credit', amountMinor: expected },
          {
            account: 'advisor_commission_pending',
            direction: 'debit',
            amountMinor: advisor,
            advisorId: c.advisor_id,
          },
          {
            account: 'advisor_payable',
            direction: 'credit',
            amountMinor: advisor,
            advisorId: c.advisor_id,
          },
        ],
      });
      await tx.query(
        `UPDATE commission.commissions SET status = 'payable', received_at = now(), released_at = now(), updated_at = now() WHERE id = $1`,
        [c.id],
      );
      await this.audit.record({
        actorType: 'user',
        actorId,
        action: 'commission.released',
        entityType: 'commission',
        entityId: c.id,
        module: 'commission-payments',
        metadata: { bookingId: c.booking_id, advisorMinor: String(advisor), currency: c.currency },
      });
      await tx.publish({
        type: 'CommissionReleased',
        version: 1,
        payload: {
          commissionId: c.id,
          bookingId: c.booking_id,
          advisorId: c.advisor_id,
          amount: m(advisor, c.currency),
        },
      });
      return this.view({ ...c, status: 'payable' });
    });
  }

  // ---------- Reversal (FR-COM-06) ----------

  /**
   * A cancelled booking earns nothing: reverse every commission on it with new, opposite ledger entries. How
   * depends on how far the commission got: before the supplier paid, the receivable is written off; after, the
   * money goes back and the advisor's payable is taken away.
   */
  private async reverseBooking(tx: Tx, bookingId: string, reason: string): Promise<void> {
    await tx.setLocal('atp.scope', 'all');
    const rows = await tx.query<CommissionRow>(`${SELECT} WHERE booking_id = $1 FOR UPDATE`, [
      bookingId,
    ]);
    for (const c of rows) {
      if (c.status === 'reversed') continue;
      if (c.status === 'paid') {
        // Already paid out: recovering it from the next payout is Sprint 8 (AC-08). Flag it for finance.
        await this.audit.record({
          actorType: 'system',
          actorId: null,
          action: 'commission.clawback_needed',
          entityType: 'commission',
          entityId: c.id,
          module: 'commission-payments',
          metadata: { bookingId, reason },
        });
        continue;
      }
      const wasPayable = c.status === 'payable';
      const expected = BigInt(c.expected_minor);
      const advisor = BigInt(c.advisor_minor);
      const platform = BigInt(c.platform_minor);
      await this.post(tx, {
        kind: 'reversal',
        refType: 'commission',
        refId: c.id,
        description: `Reversal of commission on ${c.property_name}`,
        currency: c.currency,
        entries: [
          { account: 'platform_revenue', direction: 'debit', amountMinor: platform },
          wasPayable
            ? {
                account: 'advisor_payable',
                direction: 'debit',
                amountMinor: advisor,
                advisorId: c.advisor_id,
              }
            : {
                account: 'advisor_commission_pending',
                direction: 'debit',
                amountMinor: advisor,
                advisorId: c.advisor_id,
              },
          wasPayable
            ? { account: 'cash_clearing', direction: 'credit', amountMinor: expected }
            : { account: 'supplier_receivable', direction: 'credit', amountMinor: expected },
        ],
      });
      await tx.query(
        `UPDATE commission.commissions SET status = 'reversed', reversal_reason = $2, reversed_at = now(), updated_at = now() WHERE id = $1`,
        [c.id, reason],
      );
      await this.audit.record({
        actorType: 'system',
        actorId: null,
        action: 'commission.reversed',
        entityType: 'commission',
        entityId: c.id,
        module: 'commission-payments',
        metadata: { bookingId, reason, wasPayable },
      });
      await tx.publish({
        type: 'CommissionReversed',
        version: 1,
        payload: {
          commissionId: c.id,
          bookingId,
          advisorId: c.advisor_id,
          commissionable: m(c.commissionable_minor, c.currency),
          advisorShare: m(advisor, c.currency),
          reason,
          wasPayable,
        },
      });
    }
  }

  // ---------- Views ----------

  private view(c: CommissionRow) {
    return {
      id: c.id,
      bookingId: c.booking_id,
      propertyName: c.property_name,
      checkIn: c.check_in,
      checkOut: c.check_out,
      commissionable: m(c.commissionable_minor, c.currency),
      rateBps: c.rate_bps,
      expected: m(c.expected_minor, c.currency),
      tier: c.tier_code,
      advisorShareBps: c.advisor_share_bps,
      advisorShare: m(c.advisor_minor, c.currency),
      status: c.status,
      reversalReason: c.reversal_reason,
      recognizedAt: c.recognized_at.toISOString(),
      releasedAt: c.released_at?.toISOString() ?? null,
    };
  }

  /** The advisor's own commissions and what they add up to (FR-COM-08: itemised earnings). */
  async forAdvisor(advisorId: string, q: { status?: string | undefined }) {
    return this.db.transaction('commission-payments', async (tx) => {
      await tx.setLocal('atp.advisor_id', advisorId);
      const rows = await tx.query<CommissionRow>(
        `${SELECT} WHERE advisor_id = $1 AND ($2::text IS NULL OR status = $2) ORDER BY recognized_at DESC LIMIT 500`,
        [advisorId, q.status ?? null],
      );
      const totals = await tx.query<{
        status: string;
        currency: string;
        advisor: string;
        expected: string;
      }>(
        `SELECT status, currency, sum(advisor_minor)::text AS advisor, sum(expected_minor)::text AS expected
           FROM commission.commissions WHERE advisor_id = $1 GROUP BY status, currency`,
        [advisorId],
      );
      const sum = (status: string) =>
        totals.filter((t) => t.status === status).reduce((n, t) => n + BigInt(t.advisor), 0n);
      const currency = rows[0]?.currency ?? 'USD';
      return {
        items: rows.map((r) => this.view(r)),
        totals: {
          pending: m(
            sum('expected') + sum('invoiced') + sum('received') + sum('reconciled'),
            currency,
          ),
          payable: m(sum('payable'), currency),
          paid: m(sum('paid'), currency),
          reversed: m(sum('reversed'), currency),
        },
      };
    });
  }

  async forFinance(q: { status?: string | undefined; advisorId?: string | undefined }) {
    return this.db.transaction('commission-payments', async (tx) => {
      await tx.setLocal('atp.scope', 'all');
      const rows = await tx.query<CommissionRow>(
        `${SELECT} WHERE ($1::text IS NULL OR status = $1) AND ($2::uuid IS NULL OR advisor_id = $2)
          ORDER BY recognized_at DESC LIMIT 500`,
        [q.status ?? null, q.advisorId ?? null],
      );
      return {
        items: rows.map((r) => ({
          ...this.view(r),
          advisorId: r.advisor_id,
          supplier: r.supplier,
          platformShare: m(r.platform_minor, r.currency),
        })),
      };
    });
  }

  /** Debits and credits per account. They must match; a mismatch is a bug and an incident (NFR "variance = 0"). */
  async trialBalance() {
    const rows = await this.db.read<{
      account: string;
      currency: string;
      debit: string;
      credit: string;
    }>(
      'commission-payments',
      `SELECT account, currency,
              coalesce(sum(amount_minor) FILTER (WHERE direction = 'debit'), 0)::text AS debit,
              coalesce(sum(amount_minor) FILTER (WHERE direction = 'credit'), 0)::text AS credit
         FROM commission.ledger_entries GROUP BY account, currency ORDER BY account`,
    );
    const debit = rows.reduce((n, r) => n + BigInt(r.debit), 0n);
    const credit = rows.reduce((n, r) => n + BigInt(r.credit), 0n);
    return {
      accounts: rows.map((r) => ({
        account: r.account,
        currency: r.currency,
        debit: r.debit,
        credit: r.credit,
        balance: String(BigInt(r.debit) - BigInt(r.credit)),
      })),
      totalDebit: String(debit),
      totalCredit: String(credit),
      balanced: debit === credit,
    };
  }
}
