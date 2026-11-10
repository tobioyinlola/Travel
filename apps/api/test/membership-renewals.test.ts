import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MembershipService } from '../src/modules/membership/application/membership.service.js';
import { startApp, type TestApp } from './app-harness.js';

type Agent = ReturnType<typeof request.agent>;
const DAY = 86_400_000;

describe('membership renewals and dunning (FR-MEM-03)', () => {
  let t: TestApp;
  let ada: { agent: Agent; advisorId: string };
  let svc: MembershipService;

  beforeAll(async () => {
    t = await startApp();
    svc = t.app.get(MembershipService);
  });
  beforeEach(async () => {
    await t.reset();
    ada = await t.onboardAdvisor('ada@example.com', { essentials: true });
  });
  afterAll(() => t.close());

  const m = async () =>
    (
      await t.admin.query(
        `SELECT status, current_period_end, payment_method_ref FROM membership.memberships WHERE advisor_id = $1`,
        [ada.advisorId],
      )
    ).rows[0] as {
      status: string;
      current_period_end: Date;
      payment_method_ref: string;
    };
  const setEnd = (end: Date) =>
    t.admin.query(
      `UPDATE membership.memberships SET current_period_end = $2 WHERE advisor_id = $1`,
      [ada.advisorId, end],
    );
  const mail = (re: RegExp) =>
    t.mail.sent.filter((x) => x.to === 'ada@example.com' && re.test(x.subject));
  const invoices = async () =>
    (
      await t.admin.query(
        `SELECT kind, status, attempts, total_minor, next_attempt_at FROM membership.invoices WHERE advisor_id = $1 ORDER BY issued_at`,
        [ada.advisorId],
      )
    ).rows;

  it('reminds the advisor once, a week before the period ends', async () => {
    await setEnd(new Date(Date.now() + 5 * DAY));
    expect(await svc.runRenewals()).toMatchObject({ reminders: 1, renewals: 0 });
    await t.settle();
    expect(mail(/renews on/)).toHaveLength(1);
    expect(await svc.runRenewals()).toMatchObject({ reminders: 0 });
    await setEnd(new Date(Date.now() + 20 * DAY));
    expect((await svc.runRenewals()).reminders).toBe(0); // too early
  });

  it('renews automatically when the period ends: charges the plan price and starts the next period', async () => {
    const end = new Date(Date.now() - 3_600_000);
    await setEnd(end);
    expect(await svc.runRenewals()).toMatchObject({ renewals: 1 });
    await t.settle();
    const after = await m();
    expect(after.status).toBe('active');
    // The new period begins where the old one ended (no gap, no overlap): one year later.
    expect(new Date(after.current_period_end).getUTCFullYear()).toBe(end.getUTCFullYear() + 1);
    const inv = (await invoices()).at(-1);
    expect(inv).toMatchObject({ kind: 'renewal', status: 'paid', total_minor: '29900' });
    expect(mail(/receipt|invoice|payment/i).length).toBeGreaterThan(0);
    expect((await svc.runRenewals()).renewals).toBe(0); // nothing due any more
  });

  it('retries a declined renewal on the dunning schedule, then lapses the membership', async () => {
    await t.admin.query(
      `UPDATE membership.memberships SET payment_method_ref = 'pm_fake_declined' WHERE advisor_id = $1`,
      [ada.advisorId],
    );
    await setEnd(new Date(Date.now() - 3_600_000));
    await svc.runRenewals();
    await t.settle();
    expect(await m()).toMatchObject({ status: 'past_due' });
    expect((await invoices()).at(-1)).toMatchObject({
      kind: 'renewal',
      status: 'open',
      attempts: 1,
    });
    expect(mail(/payment|card/i).length).toBeGreaterThan(0);

    expect((await svc.runRenewals()).retries).toBe(0); // not yet: first retry is a day later
    const steps: Array<[number, number]> = [
      [1.1, 2],
      [4.2, 3],
      [11.3, 4],
    ];
    for (const [days, attempts] of steps) {
      expect((await svc.runRenewals(new Date(Date.now() + days * DAY))).retries).toBe(1);
      await t.settle();
      if (attempts < 4)
        expect((await invoices()).at(-1)).toMatchObject({ status: 'open', attempts });
    }
    expect(await m()).toMatchObject({ status: 'cancelled' });
    expect((await invoices()).at(-1)).toMatchObject({ status: 'void', attempts: 4 });
    expect(mail(/cancelled/i)).toHaveLength(1);
    expect((await svc.runRenewals(new Date(Date.now() + 30 * DAY))).retries).toBe(0);
  });

  it('a new card during the grace period pays the open renewal and restores the membership', async () => {
    await t.admin.query(
      `UPDATE membership.memberships SET payment_method_ref = 'pm_fake_declined' WHERE advisor_id = $1`,
      [ada.advisorId],
    );
    await setEnd(new Date(Date.now() - 3_600_000));
    await svc.runRenewals();
    await t.settle();
    expect((await m()).status).toBe('past_due');
    await ada.agent
      .put('/v1/membership/payment-method')
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ paymentMethodRef: 'pm_fake_visa' })
      .expect(200);
    await t.settle();
    expect((await m()).status).toBe('active');
    expect((await invoices()).at(-1)).toMatchObject({ status: 'paid' });
    const pastDue = (
      await t.admin.query(
        `SELECT past_due_since FROM membership.memberships WHERE advisor_id = $1`,
        [ada.advisorId],
      )
    ).rows[0];
    expect(pastDue.past_due_since).toBeNull();
  });

  it('does not renew a membership that was cancelled at period end', async () => {
    await ada.agent.post('/v1/membership/cancel').expect(200);
    await setEnd(new Date(Date.now() - 3_600_000));
    expect((await svc.runRenewals()).renewals).toBe(0);
    expect(await svc.endCancelledPeriods()).toBe(1);
    expect((await m()).status).toBe('cancelled');
    expect((await invoices()).filter((i) => i.kind === 'renewal')).toHaveLength(0);
  });
});
