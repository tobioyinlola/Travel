import { HttpStatus, Injectable } from '@nestjs/common';
import { AuditWriter } from '../../../platform/audit/audit-writer.js';
import { Database } from '../../../platform/db/database.js';
import { ProblemException, problemType } from '../../../platform/http/problem.js';
import { newId } from '../../shared-kernel/index.js';

const problem = (status: HttpStatus, slug: string, title: string, detail?: string) =>
  new ProblemException(status, problemType(slug), title, detail);

export interface PlanInput {
  code: string;
  name: string;
  billingPeriod: 'quarter' | 'year';
  priceMinor: string;
  currency: string;
  active: boolean;
}
export interface TierInput {
  code: string;
  name: string;
  minSalesMinor: string;
  advisorShareBps: number;
}

/**
 * Plans and split tiers as data an admin changes without a deploy (FR-ADM-04). Changes apply to charges and sales
 * from now on: existing invoices are untouched and a recognised commission keeps the split it was given.
 */
@Injectable()
export class MembershipConfigService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditWriter,
  ) {}

  async listPlans() {
    const rows = await this.db.read<{
      code: string;
      name: string;
      billing_period: 'quarter' | 'year';
      price_minor: string;
      currency: string;
      active: boolean;
    }>('membership', 'SELECT * FROM membership.plans ORDER BY price_minor DESC, code');
    return rows.map((p) => ({
      code: p.code,
      name: p.name,
      billingPeriod: p.billing_period,
      price: { amountMinor: p.price_minor, currency: p.currency },
      active: p.active,
    }));
  }

  async upsertPlan(input: PlanInput, actorId: string) {
    await this.db.transaction('membership', async (tx) => {
      const [before] = await tx.query(`SELECT * FROM membership.plans WHERE code = $1`, [
        input.code,
      ]);
      await tx.query(
        `INSERT INTO membership.plans (id, code, name, billing_period, price_minor, currency, active)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, billing_period = EXCLUDED.billing_period,
           price_minor = EXCLUDED.price_minor, currency = EXCLUDED.currency, active = EXCLUDED.active`,
        [
          newId(),
          input.code,
          input.name,
          input.billingPeriod,
          input.priceMinor,
          input.currency,
          input.active,
        ],
      );
      await this.audit.record({
        actorType: 'user',
        actorId,
        action: before ? 'plan.updated' : 'plan.created',
        entityType: 'plan',
        entityId: input.code,
        module: 'membership',
        before: before ?? null,
        after: input,
      });
    });
    return (await this.listPlans()).find((p) => p.code === input.code)!;
  }

  async listTiers() {
    const rows = await this.db.read<{
      code: string;
      name: string;
      position: number;
      min_sales_minor: string;
      advisor_share_bps: number;
      currency: string;
    }>('membership', 'SELECT * FROM membership.split_tiers ORDER BY position');
    return rows.map((t) => ({
      code: t.code,
      name: t.name,
      position: t.position,
      minSales: { amountMinor: t.min_sales_minor, currency: t.currency },
      advisorShareBps: t.advisor_share_bps,
    }));
  }

  /**
   * Replace the ladder. Rules: starts at 0, thresholds strictly rise, shares never fall, and no tier an advisor may
   * be on is removed (codes can only be added or edited).
   */
  async replaceTiers(tiers: TierInput[], actorId: string) {
    if (tiers.length === 0)
      throw problem(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'tiers-invalid',
        'At least one tier is required',
      );
    if (BigInt(tiers[0]!.minSalesMinor) !== 0n)
      throw problem(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'tiers-invalid',
        'The first tier must start at zero sales',
      );
    for (let i = 1; i < tiers.length; i++) {
      if (BigInt(tiers[i]!.minSalesMinor) <= BigInt(tiers[i - 1]!.minSalesMinor))
        throw problem(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'tiers-invalid',
          'Thresholds must rise from one tier to the next',
        );
      if (tiers[i]!.advisorShareBps < tiers[i - 1]!.advisorShareBps)
        throw problem(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'tiers-invalid',
          'A higher tier cannot pay the advisor less',
        );
    }
    if (new Set(tiers.map((t) => t.code)).size !== tiers.length)
      throw problem(HttpStatus.UNPROCESSABLE_ENTITY, 'tiers-invalid', 'Tier codes must be unique');
    await this.db.transaction('membership', async (tx) => {
      const existing = await tx.query<{ code: string }>(`SELECT code FROM membership.split_tiers`);
      const missing = existing.filter((e) => !tiers.some((t) => t.code === e.code));
      if (missing.length > 0)
        throw problem(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'tiers-invalid',
          'Existing tiers cannot be removed',
          `Keep: ${missing.map((m) => m.code).join(', ')}.`,
        );
      const before = await this.listTiers();
      // Positions are unique: park the old ones out of the way, then write the new ladder.
      await tx.query(`UPDATE membership.split_tiers SET position = position + 1000`);
      for (const [i, t] of tiers.entries())
        await tx.query(
          `INSERT INTO membership.split_tiers (code, name, position, min_sales_minor, advisor_share_bps)
           VALUES ($1, $2, $3, $4, $5)
           ON CONFLICT (code) DO UPDATE SET name = EXCLUDED.name, position = EXCLUDED.position,
             min_sales_minor = EXCLUDED.min_sales_minor, advisor_share_bps = EXCLUDED.advisor_share_bps`,
          [t.code, t.name, i + 1, t.minSalesMinor, t.advisorShareBps],
        );
      await this.audit.record({
        actorType: 'user',
        actorId,
        action: 'tiers.replaced',
        entityType: 'split_tiers',
        entityId: 'ladder',
        module: 'membership',
        before,
        after: tiers,
      });
    });
    return this.listTiers();
  }
}
