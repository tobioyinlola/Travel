import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from './app-harness.js';
import { confirmedBooking, supplierPays } from './flows.js';

type Agent = ReturnType<typeof request.agent>;

describe('reporting (FR-RPT-01, 02, 03, 06)', () => {
  let t: TestApp;
  let ada: { agent: Agent; advisorId: string };
  let clientId: string;
  let fin: Agent;

  beforeAll(async () => {
    t = await startApp();
    await t.ingestCatalog();
  });
  beforeEach(async () => {
    await t.reset();
    await t.ingestCatalog();
    ada = await t.onboardAdvisor('ada@example.com', { essentials: true });
    clientId = (
      await ada.agent
        .post('/v1/clients')
        .send({ firstName: 'Grace', lastName: 'Hopper', email: 'grace@example.com' })
        .expect(201)
    ).body.id;
    fin = await t.admin1();
  });
  afterAll(() => t.close());

  it("an advisor's dashboard: pipeline, bookings, commission, tier and suppliers (FR-RPT-01)", async () => {
    const a = await confirmedBooking(t, ada.agent, clientId, 60);
    const b = await confirmedBooking(t, ada.agent, clientId, 80);
    await supplierPays(fin, ada.agent, a);
    await ada.agent
      .post(`/v1/bookings/${b.id}/cancel`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ reason: 'Traveler cancelled' })
      .expect(200);
    await t.settle();

    const r = (await ada.agent.get('/v1/reports/advisor').expect(200)).body;
    expect(r.pipeline).toMatchObject({
      proposalsSent: 2,
      proposalsApproved: 2,
      approvalRatePercent: 100,
    });
    expect(r.bookings).toMatchObject({ confirmed: 2, cancelled: 1, net: 1 });
    expect(BigInt(r.bookings.value.amountMinor)).toBeGreaterThan(0n);
    const items = (await ada.agent.get('/v1/commissions').expect(200)).body.items as Array<{
      bookingId: string;
      status: string;
      advisorShare: { amountMinor: string };
    }>;
    const keep = items.find((i) => i.bookingId === a.id)!;
    expect(r.commission.earned.amountMinor).toBe(keep.advisorShare.amountMinor); // the cancelled one is reversed
    expect(r.commission.payable.amountMinor).toBe(keep.advisorShare.amountMinor);
    expect(r.commission.paid.amountMinor).toBe('0');
    expect(r.tier).toMatchObject({ tier: 'starter' });
    expect(r.topSuppliers.length).toBeGreaterThan(0);
    expect(r.topSuppliers[0]).toMatchObject({ hotels: expect.any(Number) });

    // Outside the period there is nothing; another advisor sees none of it.
    const future = (
      await ada.agent
        .get('/v1/reports/advisor')
        .query({ from: '2100-01-01', to: '2100-02-01' })
        .expect(200)
    ).body;
    expect(future.bookings.confirmed).toBe(0);
    const bob = await t.onboardAdvisor('bob@example.com', { essentials: true });
    expect((await bob.agent.get('/v1/reports/advisor').expect(200)).body.bookings.confirmed).toBe(
      0,
    );
  });

  it('finance report: recognised, received, payable and outstanding, by supplier (FR-RPT-02)', async () => {
    const a = await confirmedBooking(t, ada.agent, clientId, 60);
    await confirmedBooking(t, ada.agent, clientId, 80);
    const paid = await supplierPays(fin, ada.agent, a);
    await t.settle();
    const r = (await fin.get('/v1/reports/finance').expect(200)).body;
    const items = (await ada.agent.get('/v1/commissions').expect(200)).body.items as Array<{
      expected: { amountMinor: string };
    }>;
    const total = items.reduce((n, i) => n + BigInt(i.expected.amountMinor), 0n);
    expect(r.commission.recognized.amountMinor).toBe(String(total));
    expect(
      BigInt(r.commission.advisorShare.amountMinor) +
        BigInt(r.commission.platformShare.amountMinor),
    ).toBe(total);
    expect(r.commission.receivedFromSuppliers.amountMinor).toBe(paid.expected.amountMinor);
    expect(r.commission.madePayable.amountMinor).toBe(paid.advisorShare.amountMinor);
    expect(r.commission.outstanding.amountMinor).toBe(
      String(total - BigInt(paid.expected.amountMinor)),
    );
    expect(r.bySupplier.length).toBeGreaterThan(0);
    await ada.agent.get('/v1/reports/finance').expect(403);
    await ada.agent.get('/v1/reports/platform').expect(403);
  });

  it('platform metrics: activation funnel, time to first booking, active advisors, bookings by supplier (FR-RPT-03)', async () => {
    await t.onboardAdvisor('bob@example.com', { essentials: true }); // activated, never books
    await confirmedBooking(t, ada.agent, clientId, 60);
    const r = (await fin.get('/v1/reports/platform').expect(200)).body;
    expect(r.activation).toMatchObject({ applied: 2, approved: 2, active: 2, booked: 1 });
    expect(r.activation.medianDaysActiveToFirstBooking).toBeGreaterThanOrEqual(0);
    expect(r.activeAdvisors).toBe(1);
    expect(r.bookings).toMatchObject({
      confirmed: 1,
      cancelled: 0,
      failed: 0,
      proposalToBookingPercent: 100,
    });
    expect(r.bySupplier).toHaveLength(1);
    expect(r.bySupplier[0].value.amountMinor).toBe(r.bookings.gmv.amountMinor);
  });

  it('facts are keyed by event id, so no fact is ever counted twice (FR-RPT-06)', async () => {
    await confirmedBooking(t, ada.agent, clientId, 60);
    const dup = (
      await t.admin.query(
        `SELECT count(*)::int AS n FROM (SELECT event_id FROM reporting.facts GROUP BY event_id HAVING count(*) > 1) d`,
      )
    ).rows[0].n;
    expect(dup).toBe(0);
    const kinds = (await t.admin.query(`SELECT DISTINCT kind FROM reporting.facts`)).rows.map(
      (r) => r.kind,
    );
    expect(kinds).toEqual(
      expect.arrayContaining([
        'application_submitted',
        'advisor_active',
        'proposal_published',
        'proposal_approved',
        'booking_confirmed',
        'booking_line_confirmed',
        'commission_recognized',
      ]),
    );
  });
});
