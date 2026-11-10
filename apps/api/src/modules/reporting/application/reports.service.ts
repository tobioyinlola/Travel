import { Injectable } from '@nestjs/common';
import { Database } from '../../../platform/db/database.js';
import { MembershipApi } from '../../membership/index.js';

const CUR = 'USD';
const m = (minor: string | number | bigint | null | undefined) => ({
  amountMinor: String(minor ?? 0),
  currency: CUR,
});
const n = (v: string | number | null | undefined) => Number(v ?? 0);

export interface Period {
  from: Date;
  to: Date;
}

/** Default window: the last 90 days. */
export function periodOf(from?: string, to?: string, now = new Date()): Period {
  const end = to ? new Date(`${to}T00:00:00Z`) : now;
  const start = from ? new Date(`${from}T00:00:00Z`) : new Date(end.getTime() - 90 * 86_400_000);
  return { from: start, to: end };
}

const iso = (d: Date) => d.toISOString();

/**
 * Reports over the facts read model (FR-RPT-01..03). Money is USD until multi-currency (NFR-14). Everything is a
 * plain aggregate query; there is no cross-module call except the tier ladder, which Membership owns.
 */
@Injectable()
export class ReportsService {
  constructor(
    private readonly db: Database,
    private readonly membership: MembershipApi,
  ) {}

  private rows<R extends object>(sql: string, params: unknown[]): Promise<R[]> {
    return this.db.read<R>('reporting', sql, params);
  }

  /** FR-RPT-01: the advisor's own pipeline, bookings, commission and tier progress. */
  async advisor(advisorId: string, p: Period) {
    const kinds = await this.rows<{ kind: string; n: string; subjects: string; amt: string }>(
      `SELECT kind, count(*)::text AS n, count(DISTINCT subject_id)::text AS subjects, coalesce(sum(amount_minor), 0)::text AS amt
         FROM reporting.facts WHERE advisor_id = $1 AND occurred_at >= $2 AND occurred_at < $3 GROUP BY kind`,
      [advisorId, p.from, p.to],
    );
    const k = (kind: string) => kinds.find((r) => r.kind === kind);
    const sent = n(k('proposal_published')?.subjects);
    const approved = n(k('proposal_approved')?.subjects);
    const confirmed = n(k('booking_confirmed')?.n);
    const cancelled = n(k('booking_cancelled')?.n);
    const earned =
      BigInt(k('commission_recognized')?.amt ?? 0) - BigInt(k('commission_reversed')?.amt ?? 0);
    const suppliers = await this.rows<{ supplier: string; hotels: string; value: string }>(
      `SELECT supplier, count(*)::text AS hotels, sum(amount_minor)::text AS value FROM reporting.facts
        WHERE advisor_id = $1 AND kind = 'booking_line_confirmed' AND occurred_at >= $2 AND occurred_at < $3
        GROUP BY supplier ORDER BY sum(amount_minor) DESC LIMIT 5`,
      [advisorId, p.from, p.to],
    );
    return {
      period: { from: iso(p.from), to: iso(p.to) },
      pipeline: {
        proposalsSent: sent,
        proposalsApproved: approved,
        approvalRatePercent: sent === 0 ? 0 : Math.round((approved / sent) * 100),
      },
      bookings: {
        confirmed,
        cancelled,
        net: confirmed - cancelled,
        value: m(k('booking_confirmed')?.amt),
      },
      commission: {
        earned: m(earned),
        payable: m(k('commission_released')?.amt),
        paid: m(k('payout_paid')?.amt),
      },
      tier: await this.membership.tierProgress(advisorId),
      topSuppliers: suppliers.map((s) => ({
        supplier: s.supplier,
        hotels: n(s.hotels),
        value: m(s.value),
      })),
    };
  }

  /** FR-RPT-02: where the commission money stands, for finance. */
  async finance(p: Period) {
    const [t] = await this.rows<Record<string, string>>(
      `SELECT
         coalesce(sum((props->>'expected')::bigint) FILTER (WHERE kind = 'commission_recognized'), 0)::text AS expected,
         coalesce(sum(amount_minor) FILTER (WHERE kind = 'commission_recognized'), 0)::text AS advisor_share,
         coalesce(sum((props->>'platformShare')::bigint) FILTER (WHERE kind = 'commission_recognized'), 0)::text AS platform_share,
         coalesce(sum(amount_minor) FILTER (WHERE kind = 'commission_reversed'), 0)::text AS reversed,
         coalesce(sum(amount_minor) FILTER (WHERE kind = 'commission_released'), 0)::text AS released,
         coalesce(sum(amount_minor) FILTER (WHERE kind = 'supplier_payment_received'), 0)::text AS received,
         coalesce(sum(amount_minor) FILTER (WHERE kind = 'payout_paid'), 0)::text AS paid_out
       FROM reporting.facts WHERE occurred_at >= $1 AND occurred_at < $2`,
      [p.from, p.to],
    );
    const bySupplier = await this.rows<{ supplier: string; expected: string; received: string }>(
      `SELECT supplier,
              coalesce(sum((props->>'expected')::bigint) FILTER (WHERE kind = 'commission_recognized'), 0)::text AS expected,
              coalesce(sum(amount_minor) FILTER (WHERE kind = 'supplier_payment_received'), 0)::text AS received
         FROM reporting.facts WHERE supplier IS NOT NULL AND kind IN ('commission_recognized', 'supplier_payment_received')
          AND occurred_at >= $1 AND occurred_at < $2 GROUP BY supplier ORDER BY supplier`,
      [p.from, p.to],
    );
    const expected = BigInt(t!.expected ?? 0);
    const received = BigInt(t!.received ?? 0);
    return {
      period: { from: iso(p.from), to: iso(p.to) },
      commission: {
        recognized: m(t!.expected),
        advisorShare: m(t!.advisor_share),
        platformShare: m(t!.platform_share),
        reversed: m(t!.reversed),
        receivedFromSuppliers: m(t!.received),
        madePayable: m(t!.released),
        paidToAdvisors: m(t!.paid_out),
        /** Recognised in the period but not yet received from suppliers (can be negative if older sales were paid). */
        outstanding: m(expected - received),
      },
      bySupplier: bySupplier.map((s) => ({
        supplier: s.supplier,
        recognized: m(s.expected),
        received: m(s.received),
      })),
    };
  }

  /** FR-RPT-03: how well advisors are activating and booking. */
  async platform(p: Period) {
    const [life] = await this.rows<Record<string, string | null>>(
      `WITH a AS (
         SELECT advisor_id,
                min(occurred_at) FILTER (WHERE kind = 'application_submitted') AS applied,
                min(occurred_at) FILTER (WHERE kind = 'advisor_approved') AS approved,
                min(occurred_at) FILTER (WHERE kind = 'advisor_active') AS active,
                min(occurred_at) FILTER (WHERE kind = 'booking_confirmed') AS first_booking
           FROM reporting.facts WHERE advisor_id IS NOT NULL GROUP BY advisor_id)
       SELECT count(*) FILTER (WHERE applied >= $1 AND applied < $2)::text AS applied,
              count(*) FILTER (WHERE applied >= $1 AND applied < $2 AND approved IS NOT NULL)::text AS approved,
              count(*) FILTER (WHERE applied >= $1 AND applied < $2 AND active IS NOT NULL)::text AS active,
              count(*) FILTER (WHERE applied >= $1 AND applied < $2 AND first_booking IS NOT NULL)::text AS booked,
              (percentile_cont(0.5) WITHIN GROUP (ORDER BY extract(epoch FROM (first_booking - active)) / 86400)
                 FILTER (WHERE active IS NOT NULL AND first_booking IS NOT NULL AND first_booking >= active
                           AND first_booking >= $1 AND first_booking < $2))::text AS median_days
         FROM a`,
      [p.from, p.to],
    );
    const [totals] = await this.rows<Record<string, string>>(
      `SELECT count(*) FILTER (WHERE kind = 'booking_confirmed')::text AS confirmed,
              count(*) FILTER (WHERE kind = 'booking_cancelled')::text AS cancelled,
              count(*) FILTER (WHERE kind = 'booking_failed')::text AS failed,
              coalesce(sum(amount_minor) FILTER (WHERE kind = 'booking_confirmed'), 0)::text AS gmv,
              count(DISTINCT subject_id) FILTER (WHERE kind = 'proposal_published')::text AS proposals,
              count(DISTINCT subject_id) FILTER (WHERE kind = 'proposal_approved')::text AS approved
         FROM reporting.facts WHERE occurred_at >= $1 AND occurred_at < $2`,
      [p.from, p.to],
    );
    const [active] = await this.rows<{ n: string }>(
      `SELECT count(DISTINCT advisor_id)::text AS n FROM reporting.facts
        WHERE kind = 'booking_confirmed' AND occurred_at >= $1 AND occurred_at < $2`,
      [new Date(p.to.getTime() - 90 * 86_400_000), p.to],
    );
    const suppliers = await this.rows<{ supplier: string; hotels: string; value: string }>(
      `SELECT supplier, count(*)::text AS hotels, sum(amount_minor)::text AS value FROM reporting.facts
        WHERE kind = 'booking_line_confirmed' AND occurred_at >= $1 AND occurred_at < $2
        GROUP BY supplier ORDER BY sum(amount_minor) DESC`,
      [p.from, p.to],
    );
    const proposals = n(totals!.proposals);
    return {
      period: { from: iso(p.from), to: iso(p.to) },
      activation: {
        applied: n(life!.applied),
        approved: n(life!.approved),
        active: n(life!.active),
        booked: n(life!.booked),
        medianDaysActiveToFirstBooking:
          life!.median_days === null ? null : Math.round(Number(life!.median_days) * 10) / 10,
      },
      /** Advisors with at least one confirmed booking in the 90 days to the end of the period. */
      activeAdvisors: n(active!.n),
      bookings: {
        confirmed: n(totals!.confirmed),
        cancelled: n(totals!.cancelled),
        failed: n(totals!.failed),
        gmv: m(totals!.gmv),
        proposalToBookingPercent:
          proposals === 0 ? 0 : Math.round((n(totals!.confirmed) / proposals) * 100),
      },
      bySupplier: suppliers.map((s) => ({
        supplier: s.supplier,
        hotels: n(s.hotels),
        value: m(s.value),
      })),
    };
  }
}
