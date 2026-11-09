import { HttpStatus, Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { Money, newId } from '../../shared-kernel/index.js';
import { IdentityApi } from '../../identity/index.js';
import { AuditWriter } from '../../../platform/audit/audit-writer.js';
import { Database } from '../../../platform/db/database.js';
import type { Tx } from '../../../platform/db/tx.js';
import { EventBus } from '../../../platform/events/event-bus.js';
import { ProblemException, problemType } from '../../../platform/http/problem.js';
import { JobRegistry } from '../../../platform/jobs/job-registry.js';
import { periodEnd, promoProblem, quote, type PromoCode, type Quote } from '../domain/pricing.js';
import { BILLING_PORT, type BillingPort } from './billing.port.js';

interface PlanRow {
  id: string;
  code: string;
  name: string;
  billing_period: 'quarter' | 'year';
  price_minor: string;
  currency: string;
  active: boolean;
}

interface MembershipRow {
  id: string;
  advisor_id: string;
  user_id: string;
  plan_id: string;
  status: 'pending' | 'active' | 'past_due' | 'cancelled';
  promo_code: string | null;
  payment_method_ref: string | null;
  application_accepted: boolean;
  current_period_start: Date | null;
  current_period_end: Date | null;
  cancel_at_period_end: boolean;
}

interface InvoiceRow {
  id: string;
  number: string;
  membership_id: string;
  advisor_id: string;
  description: string;
  period_start: Date;
  period_end: Date;
  subtotal_minor: string;
  discount_minor: string;
  total_minor: string;
  currency: string;
  status: 'open' | 'paid' | 'void';
  attempts: number;
  last_error: string | null;
  issued_at: Date;
  paid_at: Date | null;
}

export interface PlanView {
  code: string;
  name: string;
  billingPeriod: 'quarter' | 'year';
  price: { amountMinor: string; currency: string };
}

export interface QuoteView {
  subtotal: { amountMinor: string; currency: string };
  discount: { amountMinor: string; currency: string };
  total: { amountMinor: string; currency: string };
}

export interface InvoiceView {
  id: string;
  number: string;
  description: string;
  status: 'open' | 'paid' | 'void';
  periodStart: string;
  periodEnd: string;
  subtotal: { amountMinor: string; currency: string };
  discount: { amountMinor: string; currency: string };
  total: { amountMinor: string; currency: string };
  issuedAt: string;
  paidAt: string | null;
  lastError: string | null;
}

export interface MembershipView {
  id: string;
  advisorId: string;
  status: MembershipRow['status'];
  plan: PlanView;
  promoCode: string | null;
  hasPaymentMethod: boolean;
  applicationAccepted: boolean;
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
  quote: QuoteView;
  invoices: InvoiceView[];
}

const problem = (status: HttpStatus, slug: string, title: string, detail?: string) =>
  new ProblemException(status, problemType(slug), title, detail);
const json = (m: Money) => m.toJSON();
const iso = (d: Date | null) => (d ? d.toISOString() : null);

@Injectable()
export class MembershipService implements OnModuleInit {
  constructor(
    private readonly db: Database,
    private readonly identity: IdentityApi,
    private readonly audit: AuditWriter,
    private readonly bus: EventBus,
    private readonly jobs: JobRegistry,
    @Inject(BILLING_PORT) private readonly billing: BillingPort,
  ) {}

  onModuleInit(): void {
    this.jobs.register<{ invoiceId: string }>({
      name: 'membership.charge-invoice',
      module: 'membership',
      queue: 'critical',
      maxAttempts: 8,
      handle: ({ invoiceId }) => this.chargeInvoice(invoiceId),
    });
    this.jobs.register({
      name: 'membership.end-cancelled-periods',
      module: 'membership',
      queue: 'default',
      cron: '5 0 * * *',
      handle: async () => {
        await this.endCancelledPeriods();
      },
    });
    // Admin accepted the application: take the first payment if checkout is done (AC-01, FR-MEM-02).
    this.bus.subscribe<{ advisorId: string }>({
      module: 'membership',
      handler: 'membership.onApplicationAccepted',
      event: 'AdvisorApplicationAccepted',
      version: 1,
      queue: 'critical',
      handle: async (e, tx) => {
        const [m] = await tx.query<MembershipRow>(
          `UPDATE membership.memberships SET application_accepted = true, updated_at = now()
            WHERE advisor_id = $1 RETURNING *`,
          [e.payload.advisorId],
        );
        if (m) await this.openFirstInvoice(tx, m);
      },
    });
  }

  // ---------- Plans and quotes ----------

  async listPlans(): Promise<PlanView[]> {
    const rows = await this.db.read<PlanRow>(
      'membership',
      'SELECT * FROM membership.plans WHERE active ORDER BY price_minor DESC',
    );
    return rows.map((p) => this.planView(p));
  }

  private planView(p: PlanRow): PlanView {
    return {
      code: p.code,
      name: p.name,
      billingPeriod: p.billing_period,
      price: { amountMinor: p.price_minor, currency: p.currency },
    };
  }

  private async loadPromo(
    tx: Tx,
    code: string | null,
    currency: string,
    lock = false,
  ): Promise<PromoCode | null> {
    if (!code) return null;
    const [r] = await tx.query<Record<string, unknown>>(
      `SELECT * FROM membership.promo_codes WHERE code = $1 ${lock ? 'FOR UPDATE' : ''}`,
      [code],
    );
    if (!r)
      throw problem(HttpStatus.BAD_REQUEST, 'promo-invalid', 'That promo code does not exist');
    const promo: PromoCode = {
      code: r.code as string,
      kind: r.kind as PromoCode['kind'],
      percentBps: (r.percent_bps as number | null) ?? null,
      amountMinor: r.amount_minor === null ? null : BigInt(r.amount_minor as string),
      currency: (r.currency as string | null) ?? null,
      expiresAt: (r.expires_at as Date | null) ?? null,
      maxRedemptions: (r.max_redemptions as number | null) ?? null,
      redemptions: r.redemptions as number,
      active: r.active as boolean,
    };
    const issue = promoProblem(promo, new Date(), currency);
    if (issue)
      throw problem(
        HttpStatus.BAD_REQUEST,
        'promo-invalid',
        'That promo code cannot be used',
        issue.replace('_', ' '),
      );
    return promo;
  }

  private quoteView(q: Quote): QuoteView {
    return { subtotal: json(q.subtotal), discount: json(q.discount), total: json(q.total) };
  }

  // ---------- Checkout (advisor) ----------

  /** Choose a plan, optional promo code and card. Payment is taken when the application is accepted. */
  async checkout(
    userId: string,
    input: { planCode: string; promoCode?: string | undefined; paymentMethodRef: string },
  ): Promise<MembershipView> {
    const advisor = await this.identity.getAdvisorByUser(userId);
    if (!advisor)
      throw problem(HttpStatus.CONFLICT, 'no-application', 'Submit your application first');
    if (advisor.status === 'rejected' || advisor.status === 'offboarded') {
      throw problem(
        HttpStatus.CONFLICT,
        'not-eligible',
        'Membership is not available for this account',
      );
    }
    await this.db.transaction('membership', async (tx) => {
      const [plan] = await tx.query<PlanRow>(
        'SELECT * FROM membership.plans WHERE code = $1 AND active',
        [input.planCode],
      );
      if (!plan)
        throw problem(HttpStatus.BAD_REQUEST, 'plan-invalid', 'That plan is not available');
      await this.loadPromo(tx, input.promoCode ?? null, plan.currency);
      const [existing] = await tx.query<MembershipRow>(
        'SELECT * FROM membership.memberships WHERE advisor_id = $1 FOR UPDATE',
        [advisor.id],
      );
      if (existing && existing.status !== 'pending') {
        throw problem(HttpStatus.CONFLICT, 'already-member', 'You already have a membership');
      }
      const [open] = existing
        ? await tx.query<InvoiceRow>(
            `SELECT * FROM membership.invoices WHERE membership_id = $1 AND status = 'open'`,
            [existing.id],
          )
        : [];
      if (
        open &&
        open.attempts > 0 &&
        (existing!.plan_id !== plan.id || existing!.promo_code !== (input.promoCode ?? null))
      ) {
        throw problem(
          HttpStatus.CONFLICT,
          'invoice-open',
          'A payment is already in progress for this plan',
          'Update your card instead of changing the plan.',
        );
      }
      let m: MembershipRow;
      if (existing) {
        if (open)
          await tx.query(
            `UPDATE membership.invoices SET status = 'void' WHERE id = $1 AND attempts = 0`,
            [open.id],
          );
        [m] = (await tx.query<MembershipRow>(
          `UPDATE membership.memberships SET plan_id = $2, promo_code = $3, payment_method_ref = $4, updated_at = now(),
                  version = version + 1 WHERE id = $1 RETURNING *`,
          [existing.id, plan.id, input.promoCode ?? null, input.paymentMethodRef],
        )) as [MembershipRow];
      } else {
        [m] = (await tx.query<MembershipRow>(
          `INSERT INTO membership.memberships (id, advisor_id, user_id, plan_id, status, promo_code, payment_method_ref,
                                               application_accepted)
           VALUES ($1, $2, $3, $4, 'pending', $5, $6, $7) RETURNING *`,
          [
            newId(),
            advisor.id,
            userId,
            plan.id,
            input.promoCode ?? null,
            input.paymentMethodRef,
            advisor.acceptedAt !== null,
          ],
        )) as [MembershipRow];
      }
      await this.audit.record({
        actorType: 'user',
        action: 'membership.checkout',
        entityType: 'membership',
        entityId: m.id,
        module: 'membership',
        after: { plan: plan.code, promoCode: input.promoCode ?? null },
      });
      if (m.application_accepted) await this.openFirstInvoice(tx, m);
    });
    return (await this.getForUser(userId))!;
  }

  /** New card after a decline: retry the open invoice. */
  async updatePaymentMethod(userId: string, paymentMethodRef: string): Promise<MembershipView> {
    await this.db.transaction('membership', async (tx) => {
      const [m] = await tx.query<MembershipRow>(
        `UPDATE membership.memberships SET payment_method_ref = $2, updated_at = now(), version = version + 1
          WHERE user_id = $1 RETURNING *`,
        [userId, paymentMethodRef],
      );
      if (!m) throw problem(HttpStatus.NOT_FOUND, 'not-found', 'No membership yet');
      const [open] = await tx.query<InvoiceRow>(
        `SELECT * FROM membership.invoices WHERE membership_id = $1 AND status = 'open'`,
        [m.id],
      );
      if (open)
        await tx.enqueue(
          'membership.charge-invoice',
          { invoiceId: open.id },
          { jobKey: `charge:${open.id}` },
        );
    });
    return (await this.getForUser(userId))!;
  }

  // ---------- First invoice and charging (FR-MEM-02) ----------

  private async openFirstInvoice(tx: Tx, m: MembershipRow): Promise<void> {
    if (m.status !== 'pending' || !m.payment_method_ref) return;
    const [existing] = await tx.query<InvoiceRow>(
      `SELECT * FROM membership.invoices WHERE membership_id = $1 AND status = 'open'`,
      [m.id],
    );
    if (existing) {
      await tx.enqueue(
        'membership.charge-invoice',
        { invoiceId: existing.id },
        { jobKey: `charge:${existing.id}` },
      );
      return;
    }
    const [plan] = (await tx.query<PlanRow>('SELECT * FROM membership.plans WHERE id = $1', [
      m.plan_id,
    ])) as [PlanRow];
    const promo = await this.loadPromo(tx, m.promo_code, plan.currency, true);
    const q = quote(Money.ofMinor(plan.price_minor, plan.currency), promo);
    if (promo)
      await tx.query(
        'UPDATE membership.promo_codes SET redemptions = redemptions + 1 WHERE code = $1',
        [promo.code],
      );
    const start = new Date();
    const id = newId();
    const [{ n }] = (await tx.query<{ n: string }>(
      `SELECT nextval('membership.invoice_number_seq')::text AS n`,
    )) as [{ n: string }];
    await tx.query(
      `INSERT INTO membership.invoices (id, number, membership_id, advisor_id, description, period_start, period_end,
                                        subtotal_minor, discount_minor, total_minor, currency, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'open')`,
      [
        id,
        `MEM-${start.getUTCFullYear()}-${n.padStart(6, '0')}`,
        m.id,
        m.advisor_id,
        plan.name,
        start,
        periodEnd(start, plan.billing_period),
        q.subtotal.amountMinor.toString(),
        q.discount.amountMinor.toString(),
        q.total.amountMinor.toString(),
        plan.currency,
      ],
    );
    if (q.total.isZero()) {
      await this.markPaid(tx, id, null); // fee waiver: nothing to charge
    } else {
      await tx.enqueue('membership.charge-invoice', { invoiceId: id }, { jobKey: `charge:${id}` });
    }
  }

  /** Calls the provider outside any transaction (ARCH rule 7), idempotent by invoice id. */
  async chargeInvoice(invoiceId: string): Promise<void> {
    const [inv] = await this.db.read<
      InvoiceRow & { payment_method_ref: string | null; user_id: string }
    >(
      'membership',
      `SELECT i.*, m.payment_method_ref, m.user_id FROM membership.invoices i
         JOIN membership.memberships m ON m.id = i.membership_id WHERE i.id = $1`,
      [invoiceId],
    );
    if (!inv || inv.status !== 'open' || !inv.payment_method_ref) return;
    const result = await this.billing.charge({
      paymentMethodRef: inv.payment_method_ref,
      amount: Money.ofMinor(inv.total_minor, inv.currency),
      idempotencyKey: `${inv.id}:${inv.payment_method_ref}`,
      description: `${inv.description} ${inv.number}`,
    });
    await this.db.transaction('membership', async (tx) => {
      if (result.status === 'succeeded') {
        await this.markPaid(tx, inv.id, result.chargeRef);
        return;
      }
      await tx.query(
        `UPDATE membership.invoices SET attempts = attempts + 1, last_error = $2 WHERE id = $1 AND status = 'open'`,
        [inv.id, result.reason],
      );
      await this.audit.record({
        actorType: 'provider',
        actorId: null,
        action: 'membership.payment_failed',
        entityType: 'invoice',
        entityId: inv.id,
        module: 'membership',
        metadata: { reason: result.reason, provider: this.billing.provider },
      });
      await tx.publish({
        type: 'MembershipPaymentFailed',
        version: 1,
        payload: {
          invoiceId: inv.id,
          membershipId: inv.membership_id,
          advisorId: inv.advisor_id,
          userId: inv.user_id,
          reason: result.reason,
        },
      });
    });
  }

  /** Marks the invoice paid, starts the period and approves the advisor, all in one transaction. */
  private async markPaid(tx: Tx, invoiceId: string, chargeRef: string | null): Promise<void> {
    const [inv] = await tx.query<InvoiceRow>(
      `UPDATE membership.invoices SET status = 'paid', paid_at = now(), provider_charge_ref = $2
        WHERE id = $1 AND status = 'open' RETURNING *`,
      [invoiceId, chargeRef],
    );
    if (!inv) return;
    const [m] = (await tx.query<MembershipRow>(
      `UPDATE membership.memberships SET status = 'active', current_period_start = $2, current_period_end = $3,
              updated_at = now(), version = version + 1 WHERE id = $1 RETURNING *`,
      [inv.membership_id, inv.period_start, inv.period_end],
    )) as [MembershipRow];
    await this.audit.record({
      actorType: chargeRef ? 'provider' : 'system',
      actorId: null,
      action: 'membership.invoice_paid',
      entityType: 'invoice',
      entityId: inv.id,
      module: 'membership',
      after: { total: inv.total_minor, currency: inv.currency, chargeRef },
    });
    await tx.publish({
      type: 'MembershipInvoicePaid',
      version: 1,
      payload: {
        invoiceId: inv.id,
        membershipId: m.id,
        advisorId: m.advisor_id,
        userId: m.user_id,
        total: { amountMinor: inv.total_minor, currency: inv.currency },
      },
    });
    await this.identity.approveAfterMembershipPaid(m.advisor_id);
  }

  // ---------- Cancellation (FR-MEM-07) ----------

  /** Access continues to the end of the paid period; open bookings stay serviceable. */
  async cancel(userId: string): Promise<MembershipView> {
    await this.db.transaction('membership', async (tx) => {
      const [m] = await tx.query<MembershipRow>(
        `UPDATE membership.memberships SET cancel_at_period_end = true, cancelled_at = now(), updated_at = now(),
                version = version + 1
          WHERE user_id = $1 AND status = 'active' AND NOT cancel_at_period_end RETURNING *`,
        [userId],
      );
      if (!m)
        throw problem(
          HttpStatus.CONFLICT,
          'not-cancellable',
          'There is no active membership to cancel',
        );
      await this.audit.record({
        actorType: 'user',
        action: 'membership.cancelled',
        entityType: 'membership',
        entityId: m.id,
        module: 'membership',
      });
      await tx.publish({
        type: 'MembershipCancelled',
        version: 1,
        payload: {
          membershipId: m.id,
          advisorId: m.advisor_id,
          userId: m.user_id,
          endsAt: m.current_period_end!.toISOString(),
        },
      });
    });
    return (await this.getForUser(userId))!;
  }

  async endCancelledPeriods(now = new Date()): Promise<number> {
    const rows = await this.db.transaction('membership', (tx) =>
      tx.query(
        `UPDATE membership.memberships SET status = 'cancelled', updated_at = now(), version = version + 1
          WHERE status = 'active' AND cancel_at_period_end AND current_period_end <= $1 RETURNING id`,
        [now],
      ),
    );
    return rows.length;
  }

  // ---------- Queries ----------

  async getForUser(userId: string): Promise<MembershipView | null> {
    const [m] = await this.db.read<MembershipRow>(
      'membership',
      'SELECT * FROM membership.memberships WHERE user_id = $1',
      [userId],
    );
    return m ? this.view(m) : null;
  }

  async getForAdvisor(advisorId: string): Promise<MembershipView | null> {
    const [m] = await this.db.read<MembershipRow>(
      'membership',
      'SELECT * FROM membership.memberships WHERE advisor_id = $1',
      [advisorId],
    );
    return m ? this.view(m) : null;
  }

  async quoteFor(planCode: string, promoCode: string | undefined): Promise<QuoteView> {
    return this.db.transaction('membership', async (tx) => {
      const [plan] = await tx.query<PlanRow>(
        'SELECT * FROM membership.plans WHERE code = $1 AND active',
        [planCode],
      );
      if (!plan)
        throw problem(HttpStatus.BAD_REQUEST, 'plan-invalid', 'That plan is not available');
      const promo = await this.loadPromo(tx, promoCode ?? null, plan.currency);
      return this.quoteView(quote(Money.ofMinor(plan.price_minor, plan.currency), promo));
    });
  }

  private async view(m: MembershipRow): Promise<MembershipView> {
    return this.db.transaction('membership', async (tx) => {
      const [plan] = (await tx.query<PlanRow>('SELECT * FROM membership.plans WHERE id = $1', [
        m.plan_id,
      ])) as [PlanRow];
      const invoices = await tx.query<InvoiceRow>(
        'SELECT * FROM membership.invoices WHERE membership_id = $1 ORDER BY issued_at DESC',
        [m.id],
      );
      let q: Quote;
      try {
        q = quote(
          Money.ofMinor(plan.price_minor, plan.currency),
          await this.loadPromo(tx, m.promo_code, plan.currency),
        );
      } catch {
        q = quote(Money.ofMinor(plan.price_minor, plan.currency), null); // promo since expired: show list price
      }
      return {
        id: m.id,
        advisorId: m.advisor_id,
        status: m.status,
        plan: this.planView(plan),
        promoCode: m.promo_code,
        hasPaymentMethod: Boolean(m.payment_method_ref),
        applicationAccepted: m.application_accepted,
        currentPeriodStart: iso(m.current_period_start),
        currentPeriodEnd: iso(m.current_period_end),
        cancelAtPeriodEnd: m.cancel_at_period_end,
        quote: this.quoteView(q),
        invoices: invoices.map((i) => ({
          id: i.id,
          number: i.number,
          description: i.description,
          status: i.status,
          periodStart: i.period_start.toISOString(),
          periodEnd: i.period_end.toISOString(),
          subtotal: { amountMinor: i.subtotal_minor, currency: i.currency },
          discount: { amountMinor: i.discount_minor, currency: i.currency },
          total: { amountMinor: i.total_minor, currency: i.currency },
          issuedAt: i.issued_at.toISOString(),
          paidAt: iso(i.paid_at),
          lastError: i.last_error,
        })),
      };
    });
  }

  // ---------- Admin (FR-MEM-04) ----------

  async createPromoCode(
    input: {
      code: string;
      kind: PromoCode['kind'];
      percentBps?: number | undefined;
      amount?: { amountMinor: string; currency: string } | undefined;
      description?: string | undefined;
      expiresAt?: string | undefined;
      maxRedemptions?: number | undefined;
    },
    actorId: string,
  ): Promise<{ code: string }> {
    await this.db.transaction('membership', async (tx) => {
      try {
        await tx.query(
          `INSERT INTO membership.promo_codes (code, kind, percent_bps, amount_minor, currency, description, expires_at,
                                               max_redemptions, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            input.code,
            input.kind,
            input.kind === 'percent_off' ? input.percentBps : null,
            input.kind === 'amount_off' ? input.amount?.amountMinor : null,
            input.kind === 'amount_off' ? input.amount?.currency : null,
            input.description ?? null,
            input.expiresAt ?? null,
            input.maxRedemptions ?? null,
            actorId,
          ],
        );
      } catch (e) {
        const code = (e as { code?: string }).code;
        if (code === '23505')
          throw problem(HttpStatus.CONFLICT, 'promo-exists', 'That code already exists');
        if (code === '23514')
          throw problem(
            HttpStatus.BAD_REQUEST,
            'promo-invalid',
            'Promo details do not match its kind',
          );
        throw e;
      }
      await this.audit.record({
        actorType: 'user',
        actorId,
        action: 'membership.promo_created',
        entityType: 'promo_code',
        entityId: input.code,
        module: 'membership',
        after: input,
      });
    });
    return { code: input.code };
  }
}
