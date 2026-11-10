import { HttpStatus, Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { AuditWriter } from '../../../platform/audit/audit-writer.js';
import { Database } from '../../../platform/db/database.js';
import type { Tx } from '../../../platform/db/tx.js';
import { ProblemException, problemType } from '../../../platform/http/problem.js';
import { JobRegistry, type JobContext } from '../../../platform/jobs/job-registry.js';
import { IdentityApi } from '../../identity/index.js';
import { newId } from '../../shared-kernel/index.js';
import { CommissionService } from './commission.service.js';
import { PAYOUT_PROVIDER, type PayoutProviderPort } from './payout-provider.port.js';

const problem = (status: HttpStatus, slug: string, title: string, detail?: string) =>
  new ProblemException(status, problemType(slug), title, detail);

/** Smallest payout worth sending ($10); smaller balances wait for the next run. */
export const MIN_PAYOUT_MINOR = 1000n;
export const REQUIRED_APPROVALS = 2;
const CURRENCY = 'USD';

const m = (minor: string | bigint, currency = CURRENCY) => ({
  amountMinor: String(minor),
  currency,
});

interface PayoutRow {
  id: string;
  run_id: string;
  advisor_id: string;
  advisor_user_id: string | null;
  currency: string;
  gross_minor: string;
  debt_minor: string;
  net_minor: string;
  status: 'pending' | 'paid' | 'failed' | 'skipped';
  skip_reason: string | null;
  provider_ref: string | null;
  failure_reason: string | null;
  paid_at: Date | null;
}

const payoutView = (p: PayoutRow) => ({
  id: p.id,
  runId: p.run_id,
  advisorId: p.advisor_id,
  status: p.status,
  gross: m(p.gross_minor, p.currency),
  debtApplied: m(p.debt_minor, p.currency),
  net: m(p.net_minor, p.currency),
  skipReason: p.skip_reason,
  failureReason: p.failure_reason,
  paidAt: p.paid_at?.toISOString() ?? null,
});

/**
 * Payouts to advisors (FR-COM-07, 09; AC-07, AC-08).
 *
 * A run is created in draft with one line per advisor owed money. Two different staff members approve it; only then
 * do payout jobs run. Every payout re-checks the gate right before money moves. What an advisor is owed is read
 * from the ledger, not from commission rows, so adjustments and clawbacks are always included.
 */
@Injectable()
export class PayoutsService implements OnModuleInit {
  private readonly logger = new Logger('Payouts');

  constructor(
    private readonly db: Database,
    private readonly ledger: CommissionService,
    private readonly audit: AuditWriter,
    private readonly jobs: JobRegistry,
    private readonly identity: IdentityApi,
    @Inject(PAYOUT_PROVIDER) private readonly provider: PayoutProviderPort,
  ) {}

  onModuleInit(): void {
    this.jobs.register<{ payoutId: string }>({
      name: 'commission.execute-payout',
      module: 'commission-payments',
      queue: 'critical',
      maxAttempts: 6,
      handle: (p, ctx) => this.execute(p.payoutId, ctx),
    });
  }

  private system<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction('commission-payments', async (tx) => {
      await tx.setLocal('atp.scope', 'all');
      return fn(tx);
    });
  }

  // ---------- Payout account (advisor) ----------

  async setAccount(advisorId: string, input: { accountRef: string; country: string }) {
    await this.db.transaction('commission-payments', async (tx) => {
      await tx.setLocal('atp.advisor_id', advisorId);
      await tx.query(
        `INSERT INTO commission.payout_accounts (advisor_id, account_ref, country) VALUES ($1, $2, $3)
         ON CONFLICT (advisor_id) DO UPDATE SET account_ref = EXCLUDED.account_ref, country = EXCLUDED.country, updated_at = now()`,
        [advisorId, input.accountRef, input.country],
      );
      await this.audit.record({
        actorType: 'user',
        action: 'payout.account_set',
        entityType: 'advisor',
        entityId: advisorId,
        module: 'commission-payments',
        metadata: { country: input.country },
      });
    });
    return this.forAdvisor(advisorId);
  }

  // ---------- Gate (AC-07) ----------

  /** Why this advisor cannot be paid right now; empty means they can. */
  private async blockers(tx: Tx, advisorId: string): Promise<string[]> {
    const out: string[] = [];
    // An active advisor in good standing, or one who has left: what they already earned is still theirs.
    const advisor = await this.identity.getAdvisor(advisorId);
    const eligible =
      advisor?.status === 'offboarded' || (await this.identity.canBook(advisorId)).allowed;
    if (!eligible) out.push('not_active');
    const [acct] = await tx.query(
      `SELECT 1 FROM commission.payout_accounts WHERE advisor_id = $1`,
      [advisorId],
    );
    if (!acct) out.push('no_payout_account');
    const [hold] = await tx.query(
      `SELECT 1 FROM commission.advisor_holds WHERE advisor_id = $1 AND released_at IS NULL`,
      [advisorId],
    );
    if (hold) out.push('on_hold');
    return out;
  }

  private async payableBalance(tx: Tx, advisorId: string): Promise<bigint> {
    const [r] = await tx.query<{ b: string }>(
      `SELECT coalesce(sum(CASE direction WHEN 'credit' THEN amount_minor ELSE -amount_minor END), 0)::text AS b
         FROM commission.ledger_entries WHERE account = 'advisor_payable' AND advisor_id = $1 AND currency = $2`,
      [advisorId, CURRENCY],
    );
    return BigInt(r!.b);
  }

  private async openDebt(tx: Tx, advisorId: string): Promise<bigint> {
    const [r] = await tx.query<{ d: string }>(
      `SELECT coalesce(sum(amount_minor - applied_minor), 0)::text AS d FROM commission.advisor_debts
        WHERE advisor_id = $1 AND currency = $2`,
      [advisorId, CURRENCY],
    );
    return BigInt(r!.d);
  }

  // ---------- Holds and adjustments (FR-COM-09) ----------

  async placeHold(advisorId: string, reason: string, actorId: string) {
    return this.system(async (tx) => {
      const inserted = await tx.query(
        `INSERT INTO commission.advisor_holds (id, advisor_id, reason, placed_by) VALUES ($1, $2, $3, $4)
         ON CONFLICT DO NOTHING RETURNING id`,
        [newId(), advisorId, reason, actorId],
      );
      if (inserted.length === 0)
        throw problem(
          HttpStatus.CONFLICT,
          'hold-exists',
          'This advisor already has an active hold',
        );
      await this.audit.record({
        actorType: 'user',
        actorId,
        action: 'payout.hold_placed',
        entityType: 'advisor',
        entityId: advisorId,
        module: 'commission-payments',
        metadata: { reason },
      });
      return { advisorId, onHold: true };
    });
  }

  async releaseHold(advisorId: string, note: string, actorId: string) {
    return this.system(async (tx) => {
      const released = await tx.query(
        `UPDATE commission.advisor_holds SET released_by = $2, released_at = now(), release_note = $3
          WHERE advisor_id = $1 AND released_at IS NULL RETURNING id`,
        [advisorId, actorId, note],
      );
      if (released.length === 0)
        throw problem(HttpStatus.NOT_FOUND, 'not-found', 'This advisor has no active hold');
      await this.audit.record({
        actorType: 'user',
        actorId,
        action: 'payout.hold_released',
        entityType: 'advisor',
        entityId: advisorId,
        module: 'commission-payments',
        metadata: { note },
      });
      return { advisorId, onHold: false };
    });
  }

  /** A manual correction with a reason code, posted to the ledger like any other movement. */
  async adjust(
    input: { advisorId: string; amountMinor: string; reasonCode: string; note: string },
    actorId: string,
  ) {
    const amount = BigInt(input.amountMinor);
    if (amount === 0n)
      throw problem(HttpStatus.UNPROCESSABLE_ENTITY, 'amount-invalid', 'The adjustment is zero');
    return this.system(async (tx) => {
      const id = newId();
      await tx.query(
        `INSERT INTO commission.adjustments (id, advisor_id, amount_minor, currency, reason_code, note, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [id, input.advisorId, amount, CURRENCY, input.reasonCode, input.note, actorId],
      );
      const abs = amount < 0n ? -amount : amount;
      await this.ledger.post(tx, {
        kind: 'adjustment',
        refType: 'adjustment',
        refId: id,
        description: `Adjustment (${input.reasonCode}): ${input.note}`,
        currency: CURRENCY,
        entries:
          amount > 0n
            ? [
                { account: 'platform_revenue', direction: 'debit', amountMinor: abs },
                {
                  account: 'advisor_payable',
                  direction: 'credit',
                  amountMinor: abs,
                  advisorId: input.advisorId,
                },
              ]
            : [
                {
                  account: 'advisor_payable',
                  direction: 'debit',
                  amountMinor: abs,
                  advisorId: input.advisorId,
                },
                { account: 'platform_revenue', direction: 'credit', amountMinor: abs },
              ],
      });
      await this.audit.record({
        actorType: 'user',
        actorId,
        action: 'payout.adjustment',
        entityType: 'advisor',
        entityId: input.advisorId,
        module: 'commission-payments',
        metadata: { amountMinor: String(amount), reasonCode: input.reasonCode, note: input.note },
      });
      return { id, advisorId: input.advisorId, amount: m(amount) };
    });
  }

  // ---------- Runs ----------

  async createRun(actorId: string) {
    const runId = await this.system(async (tx) => {
      const [open] = await tx.query(
        `SELECT 1 FROM commission.payout_runs WHERE status IN ('draft', 'approved')`,
      );
      if (open)
        throw problem(
          HttpStatus.CONFLICT,
          'run-in-progress',
          'A payout run is already open',
          'Finish or cancel it before starting another.',
        );
      const id = newId();
      await tx.query(
        `INSERT INTO commission.payout_runs (id, currency, created_by) VALUES ($1, $2, $3)`,
        [id, CURRENCY, actorId],
      );
      const owed = await tx.query<{ advisor_id: string }>(
        `SELECT advisor_id FROM commission.ledger_entries
          WHERE account = 'advisor_payable' AND currency = $1 AND advisor_id IS NOT NULL
          GROUP BY advisor_id
         HAVING sum(CASE direction WHEN 'credit' THEN amount_minor ELSE -amount_minor END) > 0`,
        [CURRENCY],
      );
      for (const { advisor_id: advisorId } of owed) {
        const gross = await this.payableBalance(tx, advisorId);
        const debt = await this.openDebt(tx, advisorId);
        const applied = debt < gross ? debt : gross;
        const net = gross - applied;
        const blockers = await this.blockers(tx, advisorId);
        let skip: string | null = blockers[0] ?? null;
        if (!skip && gross < MIN_PAYOUT_MINOR) skip = 'below_minimum';
        const payoutId = newId();
        const [userRow] = await tx.query<{ advisor_user_id: string | null }>(
          `SELECT advisor_user_id FROM commission.commissions WHERE advisor_id = $1 AND advisor_user_id IS NOT NULL LIMIT 1`,
          [advisorId],
        );
        await tx.query(
          `INSERT INTO commission.payouts (id, run_id, advisor_id, advisor_user_id, currency, gross_minor, debt_minor, net_minor, status, skip_reason)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            payoutId,
            id,
            advisorId,
            userRow?.advisor_user_id ?? null,
            CURRENCY,
            gross,
            applied,
            net,
            skip ? 'skipped' : 'pending',
            skip,
          ],
        );
        if (!skip)
          await tx.query(
            `INSERT INTO commission.payout_items (payout_id, commission_id)
             SELECT $1, id FROM commission.commissions WHERE advisor_id = $2 AND status = 'payable'`,
            [payoutId, advisorId],
          );
      }
      await this.audit.record({
        actorType: 'user',
        actorId,
        action: 'payout.run_created',
        entityType: 'payout_run',
        entityId: id,
        module: 'commission-payments',
        metadata: { advisors: owed.length },
      });
      return id;
    });
    return this.getRun(runId);
  }

  async cancelRun(runId: string, actorId: string) {
    await this.system(async (tx) => {
      const [r] = await tx.query<{ status: string }>(
        `SELECT status FROM commission.payout_runs WHERE id = $1 FOR UPDATE`,
        [runId],
      );
      if (!r) throw problem(HttpStatus.NOT_FOUND, 'not-found', 'Payout run not found');
      if (r.status !== 'draft')
        throw problem(HttpStatus.CONFLICT, 'run-not-draft', 'Only a draft run can be cancelled');
      await tx.query(`UPDATE commission.payout_runs SET status = 'cancelled' WHERE id = $1`, [
        runId,
      ]);
      await tx.query(
        `UPDATE commission.payouts SET status = 'skipped', skip_reason = 'run_cancelled' WHERE run_id = $1 AND status = 'pending'`,
        [runId],
      );
      await this.audit.record({
        actorType: 'user',
        actorId,
        action: 'payout.run_cancelled',
        entityType: 'payout_run',
        entityId: runId,
        module: 'commission-payments',
      });
    });
    return this.getRun(runId);
  }

  /** Two different people must approve before any money moves. */
  async approve(runId: string, actorId: string) {
    await this.system(async (tx) => {
      const [r] = await tx.query<{ status: string }>(
        `SELECT status FROM commission.payout_runs WHERE id = $1 FOR UPDATE`,
        [runId],
      );
      if (!r) throw problem(HttpStatus.NOT_FOUND, 'not-found', 'Payout run not found');
      if (r.status !== 'draft')
        throw problem(HttpStatus.CONFLICT, 'run-not-draft', `This run is ${r.status}`);
      const added = await tx.query(
        `INSERT INTO commission.payout_run_approvals (run_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING RETURNING user_id`,
        [runId, actorId],
      );
      if (added.length === 0)
        throw problem(
          HttpStatus.CONFLICT,
          'already-approved',
          'You already approved this run',
          'A second, different person must approve it.',
        );
      const [n] = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM commission.payout_run_approvals WHERE run_id = $1`,
        [runId],
      );
      await this.audit.record({
        actorType: 'user',
        actorId,
        action: 'payout.run_approved_by',
        entityType: 'payout_run',
        entityId: runId,
        module: 'commission-payments',
        metadata: { approvals: n!.n },
      });
      if (n!.n < REQUIRED_APPROVALS) return;
      await tx.query(
        `UPDATE commission.payout_runs SET status = 'approved', approved_at = now() WHERE id = $1`,
        [runId],
      );
      const pending = await tx.query<{ id: string }>(
        `SELECT id FROM commission.payouts WHERE run_id = $1 AND status = 'pending'`,
        [runId],
      );
      for (const p of pending)
        await tx.enqueue(
          'commission.execute-payout',
          { payoutId: p.id },
          { jobKey: `payout:${p.id}` },
        );
      if (pending.length === 0)
        await tx.query(
          `UPDATE commission.payout_runs SET status = 'completed', completed_at = now() WHERE id = $1`,
          [runId],
        );
    });
    return this.getRun(runId);
  }

  async getRun(runId: string) {
    return this.system(async (tx) => {
      const [r] = await tx.query<{
        id: string;
        status: string;
        created_by: string;
        created_at: Date;
        approved_at: Date | null;
        completed_at: Date | null;
      }>(`SELECT * FROM commission.payout_runs WHERE id = $1`, [runId]);
      if (!r) throw problem(HttpStatus.NOT_FOUND, 'not-found', 'Payout run not found');
      return this.runView(tx, r);
    });
  }

  async listRuns() {
    return this.system(async (tx) => {
      const rows = await tx.query<{
        id: string;
        status: string;
        created_by: string;
        created_at: Date;
        approved_at: Date | null;
        completed_at: Date | null;
      }>(`SELECT * FROM commission.payout_runs ORDER BY created_at DESC LIMIT 50`);
      const items = [];
      for (const r of rows) items.push(await this.runView(tx, r));
      return { items };
    });
  }

  private async runView(
    tx: Tx,
    r: {
      id: string;
      status: string;
      created_by: string;
      created_at: Date;
      approved_at: Date | null;
      completed_at: Date | null;
    },
  ) {
    const payouts = await tx.query<PayoutRow>(
      `SELECT * FROM commission.payouts WHERE run_id = $1 ORDER BY created_at`,
      [r.id],
    );
    const approvals = await tx.query<{ user_id: string }>(
      `SELECT user_id FROM commission.payout_run_approvals WHERE run_id = $1 ORDER BY approved_at`,
      [r.id],
    );
    const paid = payouts.filter((p) => p.status === 'paid');
    return {
      id: r.id,
      status: r.status,
      createdBy: r.created_by,
      createdAt: r.created_at.toISOString(),
      approvedBy: approvals.map((a) => a.user_id),
      approvalsNeeded: REQUIRED_APPROVALS,
      approvedAt: r.approved_at?.toISOString() ?? null,
      completedAt: r.completed_at?.toISOString() ?? null,
      totalNet: m(
        payouts.filter((p) => p.status !== 'skipped').reduce((n, p) => n + BigInt(p.net_minor), 0n),
      ),
      totalPaid: m(paid.reduce((n, p) => n + BigInt(p.net_minor), 0n)),
      payouts: payouts.map(payoutView),
    };
  }

  // ---------- Execution (job) ----------

  private async execute(payoutId: string, ctx: JobContext): Promise<void> {
    const loaded = await this.system(async (tx) => {
      const [p] = await tx.query<PayoutRow>(`SELECT * FROM commission.payouts WHERE id = $1`, [
        payoutId,
      ]);
      if (!p || p.status !== 'pending') return null;
      const [run] = await tx.query<{ status: string }>(
        `SELECT status FROM commission.payout_runs WHERE id = $1`,
        [p.run_id],
      );
      if (run?.status !== 'approved') return null;
      const blockers = await this.blockers(tx, p.advisor_id);
      const balance = await this.payableBalance(tx, p.advisor_id);
      const [acct] = await tx.query<{ account_ref: string }>(
        `SELECT account_ref FROM commission.payout_accounts WHERE advisor_id = $1`,
        [p.advisor_id],
      );
      return { p, blockers, balance, accountRef: acct?.account_ref ?? null };
    });
    if (!loaded) return;
    const { p } = loaded;

    // The gate is checked again right before money moves (AC-07): things change between approval and payment.
    const stop =
      loaded.blockers[0] ?? (loaded.balance < BigInt(p.gross_minor) ? 'balance_changed' : null);
    if (stop) return this.finish(p, { skipped: stop });

    const net = BigInt(p.net_minor);
    let providerRef: string | null = null;
    if (net > 0n) {
      try {
        const r = await this.provider.createPayout({
          accountRef: loaded.accountRef!,
          amount: m(net, p.currency),
          idempotencyKey: p.id,
          reference: `payout ${p.id}`,
        });
        if (r.status === 'failed') return this.finish(p, { failed: r.reason });
        providerRef = r.payoutRef;
      } catch (e) {
        if (ctx.attempts < ctx.maxAttempts) throw e; // retried with the same idempotency key
        return this.finish(p, { failed: 'provider_unavailable' });
      }
    }
    await this.finish(p, { paid: providerRef });
  }

  private async finish(
    p: PayoutRow,
    outcome: { paid: string | null } | { failed: string } | { skipped: string },
  ): Promise<void> {
    await this.system(async (tx) => {
      const [cur] = await tx.query<PayoutRow>(
        `SELECT * FROM commission.payouts WHERE id = $1 FOR UPDATE`,
        [p.id],
      );
      if (!cur || cur.status !== 'pending') return;
      const gross = BigInt(cur.gross_minor);
      const debt = BigInt(cur.debt_minor);
      const net = BigInt(cur.net_minor);

      if ('paid' in outcome) {
        await this.ledger.post(tx, {
          kind: 'payout',
          refType: 'payout',
          refId: cur.id,
          description: `Payout to advisor`,
          currency: cur.currency,
          entries: [
            {
              account: 'advisor_payable',
              direction: 'debit',
              amountMinor: gross,
              advisorId: cur.advisor_id,
            },
            { account: 'cash_clearing', direction: 'credit', amountMinor: net },
            {
              account: 'advisor_receivable',
              direction: 'credit',
              amountMinor: debt,
              advisorId: cur.advisor_id,
            },
          ],
        });
        // Debts are used oldest first.
        let left = debt;
        const debts = await tx.query<{ id: string; remaining: string }>(
          `SELECT id, (amount_minor - applied_minor)::text AS remaining FROM commission.advisor_debts
            WHERE advisor_id = $1 AND amount_minor > applied_minor ORDER BY created_at FOR UPDATE`,
          [cur.advisor_id],
        );
        for (const d of debts) {
          if (left <= 0n) break;
          const use = BigInt(d.remaining) < left ? BigInt(d.remaining) : left;
          await tx.query(
            `UPDATE commission.advisor_debts SET applied_minor = applied_minor + $2 WHERE id = $1`,
            [d.id, use],
          );
          left -= use;
        }
        await tx.query(
          `UPDATE commission.commissions SET status = 'paid', updated_at = now()
            WHERE status = 'payable' AND id IN (SELECT commission_id FROM commission.payout_items WHERE payout_id = $1)`,
          [cur.id],
        );
        await tx.query(
          `UPDATE commission.payouts SET status = 'paid', provider_ref = $2, paid_at = now() WHERE id = $1`,
          [cur.id, outcome.paid],
        );
        await this.audit.record({
          actorType: 'system',
          actorId: null,
          action: 'payout.paid',
          entityType: 'payout',
          entityId: cur.id,
          module: 'commission-payments',
          metadata: {
            advisorId: cur.advisor_id,
            grossMinor: String(gross),
            debtMinor: String(debt),
            netMinor: String(net),
          },
        });
        await tx.publish({
          type: 'PayoutPaid',
          version: 1,
          payload: {
            payoutId: cur.id,
            advisorId: cur.advisor_id,
            amount: m(net, cur.currency),
            ...(cur.advisor_user_id ? { advisorUserId: cur.advisor_user_id } : {}),
            gross: m(gross, cur.currency),
            debtApplied: m(debt, cur.currency),
          },
        });
      } else if ('failed' in outcome) {
        await tx.query(
          `UPDATE commission.payouts SET status = 'failed', failure_reason = $2 WHERE id = $1`,
          [cur.id, outcome.failed],
        );
        this.logger.error(`Payout ${cur.id} failed: ${outcome.failed}`);
        await tx.publish({
          type: 'PayoutFailed',
          version: 1,
          payload: {
            payoutId: cur.id,
            advisorId: cur.advisor_id,
            amount: m(net, cur.currency),
            reason: outcome.failed,
          },
        });
      } else {
        await tx.query(
          `UPDATE commission.payouts SET status = 'skipped', skip_reason = $2 WHERE id = $1`,
          [cur.id, outcome.skipped],
        );
      }
      const [left] = await tx.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM commission.payouts WHERE run_id = $1 AND status = 'pending'`,
        [cur.run_id],
      );
      if (left!.n === 0)
        await tx.query(
          `UPDATE commission.payout_runs SET status = 'completed', completed_at = now() WHERE id = $1 AND status = 'approved'`,
          [cur.run_id],
        );
    });
  }

  // ---------- Advisor statement (FR-COM-08) ----------

  async forAdvisor(advisorId: string) {
    return this.db.transaction('commission-payments', async (tx) => {
      await tx.setLocal('atp.advisor_id', advisorId);
      const [acct] = await tx.query<{ account_ref: string; country: string }>(
        `SELECT account_ref, country FROM commission.payout_accounts WHERE advisor_id = $1`,
        [advisorId],
      );
      const blockers = await this.blockers(tx, advisorId);
      const balance = await this.payableBalance(tx, advisorId);
      const debt = await this.openDebt(tx, advisorId);
      const rows = await tx.query<PayoutRow>(
        `SELECT * FROM commission.payouts WHERE advisor_id = $1 AND status IN ('paid', 'failed') ORDER BY created_at DESC LIMIT 50`,
        [advisorId],
      );
      const items = [];
      for (const p of rows) {
        const lines = await tx.query<{
          id: string;
          property_name: string;
          advisor_minor: string;
        }>(
          `SELECT c.id, c.property_name, c.advisor_minor::text FROM commission.payout_items i
             JOIN commission.commissions c ON c.id = i.commission_id WHERE i.payout_id = $1 ORDER BY c.property_name`,
          [p.id],
        );
        items.push({
          ...payoutView(p),
          lines: lines.map((l) => ({
            commissionId: l.id,
            propertyName: l.property_name,
            advisorShare: m(l.advisor_minor, p.currency),
          })),
        });
      }
      return {
        account: acct ? { country: acct.country, accountRef: acct.account_ref } : null,
        payable: m(balance),
        openDebt: m(debt),
        minimumPayout: m(MIN_PAYOUT_MINOR),
        eligible: blockers.length === 0,
        blockers,
        payouts: items,
      };
    });
  }
}
