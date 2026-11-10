import { Injectable, OnModuleInit } from '@nestjs/common';
import { Database } from '../../../platform/db/database.js';
import type { Tx } from '../../../platform/db/tx.js';
import { EventBus } from '../../../platform/events/event-bus.js';
import { nextTier, tierFor, type TierDef } from '../domain/tiers.js';

interface TierRow {
  code: string;
  position: number;
  min_sales_minor: string;
  advisor_share_bps: number;
  currency: string;
}

const toDef = (r: TierRow): TierDef => ({
  code: r.code,
  position: r.position,
  minSalesMinor: BigInt(r.min_sales_minor),
  advisorShareBps: r.advisor_share_bps,
});

export interface TierView {
  tier: string;
  tierName: string;
  advisorShareBps: number;
  year: number;
  currency: string;
  calendarYearSales: { amountMinor: string; currency: string };
  next: {
    code: string;
    name: string;
    advisorShareBps: number;
    remaining: { amountMinor: string; currency: string };
  } | null;
}

/**
 * Split tiers from calendar-year commissionable sales (FR-MEM-05). Commission tells us about each sale by
 * event; the tier at the moment a sale is recognised was already fixed, so an upgrade applies to later sales
 * only (prospective, decision D7, AC-06).
 */
@Injectable()
export class TiersService implements OnModuleInit {
  constructor(
    private readonly db: Database,
    private readonly bus: EventBus,
  ) {}

  onModuleInit(): void {
    for (const [event, sign] of [
      ['CommissionRecognized', 1n],
      ['CommissionReversed', -1n],
    ] as const) {
      this.bus.subscribe<{
        advisorId: string;
        commissionable: { amountMinor: string; currency: string };
        recognizedAt?: string;
      }>({
        module: 'membership',
        handler: `membership.tiers.${event}`,
        event,
        version: 1,
        handle: (e, tx) =>
          this.apply(tx, e.payload.advisorId, e.payload.commissionable, sign, e.occurredAt),
      });
    }
  }

  private async tiers(tx: Tx, currency: string): Promise<TierDef[]> {
    const rows = await tx.query<TierRow>(
      'SELECT * FROM membership.split_tiers WHERE currency = $1 ORDER BY position',
      [currency],
    );
    return rows.map(toDef);
  }

  private async apply(
    tx: Tx,
    advisorId: string,
    amount: { amountMinor: string; currency: string },
    sign: bigint,
    at: string | Date,
  ): Promise<void> {
    const tiers = await this.tiers(tx, amount.currency);
    if (tiers.length === 0) return; // no tier ladder in this currency: stays on the base split
    const year = new Date(at).getUTCFullYear();
    const base = tiers[0]!;
    await tx.query(
      `INSERT INTO membership.advisor_sales (advisor_id, year, currency, tier_code)
       VALUES ($1, $2, $3, $4) ON CONFLICT (advisor_id, year) DO NOTHING`,
      [advisorId, year, amount.currency, base.code],
    );
    const [row] = await tx.query<{ commissionable_minor: string; tier_code: string }>(
      `UPDATE membership.advisor_sales
          SET commissionable_minor = greatest(0, commissionable_minor + $3), updated_at = now()
        WHERE advisor_id = $1 AND year = $2 RETURNING commissionable_minor, tier_code`,
      [advisorId, year, sign * BigInt(amount.amountMinor)],
    );
    const total = BigInt(row!.commissionable_minor);
    const to = tierFor(total, tiers);
    if (to.code === row!.tier_code) return;
    await tx.query(
      `UPDATE membership.advisor_sales SET tier_code = $3 WHERE advisor_id = $1 AND year = $2`,
      [advisorId, year, to.code],
    );
    await tx.publish({
      type: 'TierChanged',
      version: 1,
      payload: {
        advisorId,
        fromTier: row!.tier_code,
        toTier: to.code,
        effectiveAt: new Date().toISOString(),
      },
    });
  }

  /** The split to apply to a sale recognised now. Read by Commission at recognition time. */
  async splitFor(advisorId: string, currency: string, now = new Date()) {
    const year = now.getUTCFullYear();
    const rows = await this.db.read<TierRow & { tier_code: string | null }>(
      'membership',
      `SELECT t.*, s.tier_code FROM membership.split_tiers t
         LEFT JOIN membership.advisor_sales s ON s.advisor_id = $1 AND s.year = $2 AND s.currency = $3
        WHERE t.currency = $3 ORDER BY t.position`,
      [advisorId, year, currency],
    );
    const base = rows[0];
    const current = rows.find((r) => r.code === rows[0]?.tier_code) ?? base;
    // USD is the only ladder until multi-currency tiers (NFR-14); other currencies use the base split.
    const fallback = { tierCode: 'starter', advisorShareBps: 7000 };
    return current
      ? { tierCode: current.code, advisorShareBps: current.advisor_share_bps }
      : fallback;
  }

  async progress(advisorId: string, now = new Date()): Promise<TierView> {
    const currency = 'USD';
    const year = now.getUTCFullYear();
    const rows = await this.db.read<TierRow & { name: string }>(
      'membership',
      'SELECT * FROM membership.split_tiers WHERE currency = $1 ORDER BY position',
      [currency],
    );
    const [sales] = await this.db.read<{ commissionable_minor: string }>(
      'membership',
      'SELECT commissionable_minor FROM membership.advisor_sales WHERE advisor_id = $1 AND year = $2 AND currency = $3',
      [advisorId, year, currency],
    );
    const total = BigInt(sales?.commissionable_minor ?? '0');
    const defs = rows.map(toDef);
    const cur = tierFor(total, defs);
    const next = nextTier(cur, defs);
    const name = (code: string) => (rows.find((r) => r.code === code) as { name: string }).name;
    return {
      tier: cur.code,
      tierName: name(cur.code),
      advisorShareBps: cur.advisorShareBps,
      year,
      currency,
      calendarYearSales: { amountMinor: String(total), currency },
      next: next
        ? {
            code: next.code,
            name: name(next.code),
            advisorShareBps: next.advisorShareBps,
            remaining: { amountMinor: String(next.minSalesMinor - total), currency },
          }
        : null,
    };
  }
}
