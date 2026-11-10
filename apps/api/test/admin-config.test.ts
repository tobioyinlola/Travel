import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MembershipService } from '../src/modules/membership/application/membership.service.js';
import { startApp, type TestApp } from './app-harness.js';
import { confirmedBooking } from './flows.js';

type Agent = ReturnType<typeof request.agent>;
const idem = () => crypto.randomUUID();

describe('admin: configuration without a deploy (FR-ADM-04)', () => {
  let t: TestApp;
  let ada: { agent: Agent; advisorId: string };
  let adm: Agent;
  let clientId: string;

  beforeAll(async () => {
    t = await startApp();
    await t.ingestCatalog();
  });
  beforeEach(async () => {
    await t.reset();
    await restoreConfig();
    await t.ingestCatalog();
    ada = await t.onboardAdvisor('ada@example.com', { essentials: true });
    clientId = (
      await ada.agent
        .post('/v1/clients')
        .send({ firstName: 'Grace', lastName: 'Hopper', email: 'grace@example.com' })
        .expect(201)
    ).body.id;
    adm = await t.admin1();
  });
  /** Config tables are reference data that tests do not reset: put them back so other test files see the defaults. */
  async function restoreConfig() {
    await t.admin.query(`UPDATE platform.feature_flags SET enabled = true`);
    await t.admin.query(`UPDATE membership.plans SET price_minor = 29900 WHERE code = 'annual'`);
    await t.admin.query(`DELETE FROM membership.plans WHERE code NOT IN ('annual', 'quarterly')`);
    await t.admin.query(`DELETE FROM membership.advisor_sales`);
    await t.admin.query(
      `DELETE FROM membership.split_tiers WHERE code NOT IN ('starter', 'pro', 'elite')`,
    );
    await t.admin.query(
      `UPDATE membership.split_tiers SET advisor_share_bps = CASE code WHEN 'starter' THEN 7000 WHEN 'pro' THEN 7500 ELSE 8000 END, min_sales_minor = CASE code WHEN 'starter' THEN 0 WHEN 'pro' THEN 30000000 ELSE 75000000 END, position = CASE code WHEN 'starter' THEN 1 WHEN 'pro' THEN 2 ELSE 3 END`,
    );
  }
  afterEach(restoreConfig);
  afterAll(() => t.close());

  const setFlag = (key: string, enabled: boolean) =>
    adm.put(`/v1/admin/flags/${key}`).send({ enabled });

  it('kill switches: pausing new bookings stops checkout, not viewing, and takes effect at once', async () => {
    const flags = (await adm.get('/v1/admin/flags').expect(200)).body.items as Array<{
      key: string;
      enabled: boolean;
    }>;
    expect(flags.map((f) => f.key)).toEqual(
      expect.arrayContaining(['new_bookings', 'ai_assistant']),
    );
    expect(flags.every((f) => f.enabled)).toBe(true);
    await ada.agent.get('/v1/admin/flags').expect(403);
    await ada.agent.put('/v1/admin/flags/new_bookings').send({ enabled: false }).expect(403);
    await setFlag('no_such_flag', false).expect(404);

    // A proposal approved, checkout not yet submitted.
    const from = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 63 * 86_400_000).toISOString().slice(0, 10);
    const trip = (
      await ada.agent
        .post('/v1/trips')
        .send({ clientId, title: 'Stay', startDate: from, endDate: to, adults: 2 })
        .expect(201)
    ).body;
    const rates = (
      await ada.agent
        .get('/v1/catalog/search')
        .query({ destination: 'lisbon', checkIn: from, checkOut: to, adults: 2 })
        .expect(200)
    ).body.results.flatMap(
      (r: { rates: Array<{ rateKey: string; refundable: boolean; paymentModes: string[] }> }) =>
        r.rates,
    );
    const rate = rates.find(
      (r: { refundable: boolean; paymentModes: string[] }) =>
        r.refundable && r.paymentModes.includes('pay_at_hotel'),
    );
    await ada.agent.post(`/v1/trips/${trip.id}/hotels`).send({ rateKey: rate.rateKey }).expect(201);
    const token = (
      (
        await ada.agent
          .post(`/v1/trips/${trip.id}/proposals`)
          .send({ sendEmail: false })
          .expect(201)
      ).body.proposal.url as string
    ).split('/p/')[1]!;
    await t
      .http()
      .post(`/v1/proposal-links/${token}/decision`)
      .send({ decision: 'approve', name: 'Grace Hopper' })
      .expect(200);
    await t.settle();
    const confirm = () =>
      t
        .http()
        .post(`/v1/checkout/${token}/confirm`)
        .set('Idempotency-Key', idem())
        .send({
          traveler: { name: 'Grace Hopper', email: 'grace@example.com' },
          paymentMode: 'pay_at_hotel',
        });

    expect((await setFlag('new_bookings', false).expect(200)).body).toMatchObject({
      key: 'new_bookings',
      enabled: false,
    });
    const paused = await confirm().expect(503);
    expect(paused.body.type).toMatch(/bookings-paused$/);
    await t.http().get(`/v1/checkout/${token}`).expect(200); // looking is still fine
    await setFlag('new_bookings', true).expect(200);
    await confirm().expect(200);
    const audit = await t.admin.query(
      `SELECT action FROM audit.log WHERE entity_id = 'new_bookings' ORDER BY occurred_at`,
    );
    expect(audit.rows.map((r) => r.action)).toEqual(
      expect.arrayContaining(['flag.disabled', 'flag.enabled']),
    );
  });

  it('the AI assistant can be switched off for everyone', async () => {
    await ada.agent.post('/v1/ai/ask').send({ question: 'hotels in Lisbon' }).expect(200);
    await setFlag('ai_assistant', false).expect(200);
    const r = await ada.agent.post('/v1/ai/ask').send({ question: 'hotels in Lisbon' }).expect(503);
    expect(r.body.type).toMatch(/ai-paused$/);
    await ada.agent.post('/v1/ai/drafts').send({ instruction: 'hotels in Lisbon' }).expect(503);
    await setFlag('ai_assistant', true).expect(200);
    await ada.agent.post('/v1/ai/ask').send({ question: 'hotels in Lisbon' }).expect(200);
  });

  it('plans: create, change the price (renewals use it) and retire, with an audit trail', async () => {
    const since = new Date(Date.now() - 1000);
    const created = (
      await adm
        .put('/v1/admin/plans/pilot')
        .send({ name: 'Pilot membership', billingPeriod: 'year', priceMinor: '9900' })
        .expect(200)
    ).body;
    expect(created).toMatchObject({
      code: 'pilot',
      price: { amountMinor: '9900', currency: 'USD' },
      active: true,
    });
    expect(
      (await t.http().get('/v1/membership/plans').expect(200)).body.map(
        (p: { code: string }) => p.code,
      ),
    ).toContain('pilot');
    await adm
      .put('/v1/admin/plans/pilot')
      .send({ name: 'Pilot membership', billingPeriod: 'year', priceMinor: '9900', active: false })
      .expect(200);
    expect(
      (await t.http().get('/v1/membership/plans').expect(200)).body.map(
        (p: { code: string }) => p.code,
      ),
    ).not.toContain('pilot');
    expect(
      (await adm.get('/v1/admin/plans').expect(200)).body.items.map(
        (p: { code: string }) => p.code,
      ),
    ).toContain('pilot'); // admins still see it
    await adm
      .put('/v1/admin/plans/bad')
      .send({ name: 'Bad', billingPeriod: 'year', priceMinor: '12.5' })
      .expect(400);
    await ada.agent
      .put('/v1/admin/plans/x')
      .send({ name: 'Nope', billingPeriod: 'year', priceMinor: '1' })
      .expect(403);

    // A price change is used by the next renewal, not by invoices already issued.
    await adm
      .put('/v1/admin/plans/annual')
      .send({ name: 'Annual membership', billingPeriod: 'year', priceMinor: '39900' })
      .expect(200);
    await t.admin.query(
      `UPDATE membership.memberships SET current_period_end = now() - interval '1 hour' WHERE advisor_id = $1`,
      [ada.advisorId],
    );
    await t.app.get(MembershipService).runRenewals();
    await t.settle();
    const inv = (
      await t.admin.query(
        `SELECT kind, total_minor FROM membership.invoices WHERE advisor_id = $1 ORDER BY issued_at`,
        [ada.advisorId],
      )
    ).rows;
    expect(inv[0].total_minor).toBe('0'); // the waived first invoice is unchanged
    expect(inv.at(-1)).toMatchObject({ kind: 'renewal', total_minor: '39900' });
    const audit = await t.admin.query(
      `SELECT action FROM audit.log WHERE entity_id = 'pilot' AND occurred_at >= $1 ORDER BY occurred_at`,
      [since],
    );
    expect(audit.rows.map((r) => r.action)).toEqual(['plan.created', 'plan.updated']);
  });

  it('tiers: the ladder is validated, applies to later sales, and existing tiers cannot be removed', async () => {
    const ladder = (await adm.get('/v1/admin/tiers').expect(200)).body.items as Array<{
      code: string;
      name: string;
      minSales: { amountMinor: string };
      advisorShareBps: number;
    }>;
    expect(ladder.map((l) => l.code)).toEqual(['starter', 'pro', 'elite']);
    const body = (
      over: Array<
        Partial<{ code: string; name: string; minSalesMinor: string; advisorShareBps: number }>
      >,
    ) => ({
      tiers: ladder.map((l, i) => ({
        code: l.code,
        name: l.name,
        minSalesMinor: l.minSales.amountMinor,
        advisorShareBps: l.advisorShareBps,
        ...(over[i] ?? {}),
      })),
    });
    const put = (b: unknown) => adm.put('/v1/admin/tiers').send(b as object);
    await put(body([{ minSalesMinor: '100' }])).expect(422); // first must start at zero
    await put(body([{}, { minSalesMinor: '0' }])).expect(422); // not rising
    await put(body([{}, { advisorShareBps: 6000 }])).expect(422); // share falls
    await put({ tiers: body([]).tiers.slice(0, 2) }).expect(422); // elite removed
    await put({
      tiers: [
        ...body([]).tiers,
        { code: 'starter', name: 'Dup', minSalesMinor: '99999999999', advisorShareBps: 9000 },
      ],
    }).expect(422); // duplicate code
    await ada.agent.put('/v1/admin/tiers').send(body([])).expect(403);

    // Raise the base split and add a top tier; the next recognised sale uses the new base.
    const ok = (
      await put({
        tiers: [
          ...body([{ advisorShareBps: 7200 }]).tiers,
          { code: 'platinum', name: 'Platinum', minSalesMinor: '150000000', advisorShareBps: 8500 },
        ],
      }).expect(200)
    ).body.items;
    expect(ok.map((l: { code: string }) => l.code)).toEqual([
      'starter',
      'pro',
      'elite',
      'platinum',
    ]);
    await booking();
    const items = (await ada.agent.get('/v1/commissions').expect(200)).body.items;
    expect(items[0]).toMatchObject({ tier: 'starter', advisorShareBps: 7200 });
    expect((await ada.agent.get('/v1/commissions/tier').expect(200)).body).toMatchObject({
      advisorShareBps: 7200,
    });
    const audit = await t.admin.query(`SELECT 1 FROM audit.log WHERE action = 'tiers.replaced'`);
    expect(audit.rowCount).toBeGreaterThan(0);
  });

  const booking = () => confirmedBooking(t, ada.agent, clientId, 60);
});
