import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from './app-harness.js';
import { confirmedBooking, supplierPays } from './flows.js';

type Agent = ReturnType<typeof request.agent>;
const idem = () => crypto.randomUUID();

describe('admin: advisor lifecycle (FR-ADM-02)', () => {
  let t: TestApp;
  let ada: { agent: Agent; advisorId: string };
  let bob: { agent: Agent; advisorId: string };
  let adm: Agent;
  let clientId: string;

  beforeAll(async () => {
    t = await startApp();
    await t.ingestCatalog();
  });
  beforeEach(async () => {
    await t.reset();
    await t.ingestCatalog();
    ada = await t.onboardAdvisor('ada@example.com', { essentials: true });
    bob = await t.onboardAdvisor('bob@example.com', { essentials: true });
    adm = await t.admin1();
    clientId = (
      await ada.agent
        .post('/v1/clients')
        .send({ firstName: 'Grace', lastName: 'Hopper', email: 'grace@example.com' })
        .expect(201)
    ).body.id;
  });
  afterAll(() => t.close());

  const act = (path: string, body: object) =>
    adm
      .post(`/v1/admin/advisors/${ada.advisorId}/${path}`)
      .set('Idempotency-Key', idem())
      .send(body);
  const status = async (id = ada.advisorId) =>
    (await t.admin.query(`SELECT status, status_reason FROM identity.advisors WHERE id = $1`, [id]))
      .rows[0];

  it('lists advisors for admins only, with filters', async () => {
    const all = (await adm.get('/v1/admin/advisors').expect(200)).body.items;
    expect(all.map((a: { id: string }) => a.id).sort()).toEqual(
      [ada.advisorId, bob.advisorId].sort(),
    );
    expect(
      (await adm.get('/v1/admin/advisors').query({ status: 'suspended' }).expect(200)).body.items,
    ).toEqual([]);
    await ada.agent.get('/v1/admin/advisors').expect(403);
    await ada.agent
      .post(`/v1/admin/advisors/${bob.advisorId}/suspend`)
      .set('Idempotency-Key', idem())
      .send({ reason: 'nope nope' })
      .expect(403);
  });

  it('suspends with a reason, blocks the advisor, and reinstates (state machine enforced)', async () => {
    await act('suspend', { reason: 'Complaint under review' }).expect(200);
    expect(await status()).toMatchObject({
      status: 'suspended',
      status_reason: 'Complaint under review',
    });
    expect(
      (await adm.get('/v1/admin/advisors').query({ status: 'suspended' }).expect(200)).body.items[0]
        .statusReason,
    ).toBe('Complaint under review');
    await act('suspend', { reason: 'again again' }).expect(409);
    await act('reinstate', { reason: 'x' }).expect(400); // reason too short

    // A suspended advisor cannot use the assistant or take bookings.
    await ada.agent.post('/v1/ai/ask').send({ question: 'hotels in Lisbon' }).expect(403);
    await act('reinstate', { reason: 'Cleared after review' }).expect(200);
    expect((await status()).status).toBe('active');
    await ada.agent.post('/v1/ai/ask').send({ question: 'hotels in Lisbon' }).expect(200);
    await act('reinstate', { reason: 'not suspended' }).expect(409);
    const audit = await t.admin.query(
      `SELECT action FROM audit.log WHERE entity_id = $1 AND action IN ('advisor.suspended', 'advisor.reinstated')`,
      [ada.advisorId],
    );
    expect(audit.rowCount).toBeGreaterThanOrEqual(2);
  });

  it("a suspended advisor's travelers cannot complete checkout", async () => {
    const from = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 63 * 86_400_000).toISOString().slice(0, 10);
    const trip = (
      await ada.agent
        .post('/v1/trips')
        .send({ clientId, title: 'Stay', startDate: from, endDate: to, adults: 2 })
        .expect(201)
    ).body;
    const res = (
      await ada.agent
        .get('/v1/catalog/search')
        .query({ destination: 'lisbon', checkIn: from, checkOut: to, adults: 2 })
        .expect(200)
    ).body.results;
    const rate = res
      .flatMap(
        (r: { rates: Array<{ rateKey: string; paymentModes: string[]; refundable: boolean }> }) =>
          r.rates,
      )
      .find(
        (r: { paymentModes: string[]; refundable: boolean }) =>
          r.refundable && r.paymentModes.includes('pay_at_hotel'),
      );
    await ada.agent.post(`/v1/trips/${trip.id}/hotels`).send({ rateKey: rate.rateKey }).expect(201);
    const url = (
      await ada.agent.post(`/v1/trips/${trip.id}/proposals`).send({ sendEmail: false }).expect(201)
    ).body.proposal.url as string;
    const token = url.split('/p/')[1]!;
    await t
      .http()
      .post(`/v1/proposal-links/${token}/decision`)
      .send({ decision: 'approve', name: 'Grace Hopper' })
      .expect(200);
    await t.settle();
    await act('suspend', { reason: 'Under investigation' }).expect(200);
    const r = await t
      .http()
      .post(`/v1/checkout/${token}/confirm`)
      .set('Idempotency-Key', idem())
      .send({
        traveler: { name: 'Grace Hopper', email: 'grace@example.com' },
        paymentMode: 'pay_at_hotel',
      })
      .expect(409);
    expect(r.body.type).toMatch(/booking-not-allowed$/);
  });

  it('offboards an advisor with nothing open, and not twice', async () => {
    await act('offboard', { reason: 'Left the platform' }).expect(200);
    expect(await status()).toMatchObject({ status: 'offboarded' });
    await act('offboard', { reason: 'Left again' }).expect(409);
    await act('reinstate', { reason: 'Come back' }).expect(409); // offboarding is final
    await ada.agent.get('/v1/bookings').expect(403);
  });

  it('offboarding with open bookings needs an active successor; bookings, trips and clients move, earned commission stays', async () => {
    const open = await confirmedBooking(t, ada.agent, clientId, 60);
    const past = await confirmedBooking(t, ada.agent, clientId, 80);
    await t.admin.query(
      `UPDATE booking.lines SET check_in = current_date - 5, check_out = current_date - 2 WHERE booking_id = $1`,
      [past.id],
    );

    const need = await act('offboard', { reason: 'Left the platform' }).expect(409);
    expect(need.body.type).toMatch(/open-bookings$/);
    expect(need.body.detail).toMatch(/reassignToAdvisorId/);
    expect((await status()).status).toBe('active'); // nothing happened yet
    await act('offboard', {
      reason: 'Left the platform',
      reassignToAdvisorId: ada.advisorId,
    }).expect(422);
    const carl = await t.onboardAdvisor('carl@example.com'); // approved only, not active
    await act('offboard', {
      reason: 'Left the platform',
      reassignToAdvisorId: carl.advisorId,
    }).expect(422);
    await act('offboard', {
      reason: 'Left the platform',
      reassignToAdvisorId: '00000000-0000-7000-8000-000000000000',
    }).expect(422);

    const res = (
      await act('offboard', {
        reason: 'Left the platform',
        reassignToAdvisorId: bob.advisorId,
      }).expect(200)
    ).body;
    expect(res).toMatchObject({ reassignedBookings: 1, advisor: { status: 'offboarded' } });
    await t.settle();

    // The open booking, its trip and its client now belong to Bob; the finished stay did not move.
    const bobs = (await bob.agent.get('/v1/bookings').expect(200)).body.items as Array<{
      id: string;
    }>;
    expect(bobs.map((b) => b.id)).toEqual([open.id]);
    await bob.agent.get(`/v1/trips/${open.tripId}`).expect(200);
    await bob.agent.get(`/v1/clients/${clientId}`).expect(200);
    const owners = (
      await t.admin.query(`SELECT owner_advisor_id FROM booking.bookings WHERE id = $1`, [past.id])
    ).rows[0];
    expect(owners.owner_advisor_id).toBe(ada.advisorId);
    // Bob can service it: cancel works for him.
    await bob.agent
      .post(`/v1/bookings/${open.id}/cancel`)
      .set('Idempotency-Key', idem())
      .send({ reason: 'Traveler cancelled' })
      .expect(200);
    // Commission already earned stays with Ada.
    const c = (
      await t.admin.query(`SELECT advisor_id FROM commission.commissions WHERE booking_id = $1`, [
        open.id,
      ])
    ).rows[0];
    expect(c.advisor_id).toBe(ada.advisorId);
  });

  it('an offboarded advisor is still paid what they earned (the payout gate allows it)', async () => {
    const booking = await confirmedBooking(t, ada.agent, clientId, 80);
    await ada.agent
      .put('/v1/payouts/account')
      .send({ accountRef: 'acct_fake_ada', country: 'NG' })
      .expect(200);
    const c = await supplierPays(adm, ada.agent, booking);
    await t.admin.query(
      `UPDATE booking.lines SET check_in = current_date - 5, check_out = current_date - 2`,
    ); // the stay is over
    await act('offboard', { reason: 'Left the platform' }).expect(200);

    const run = (
      await adm.post('/v1/finance/payout-runs').set('Idempotency-Key', idem()).expect(201)
    ).body;
    expect(run.payouts[0]).toMatchObject({
      advisorId: ada.advisorId,
      status: 'pending',
      net: c.advisorShare,
    });
    const second = await t.signInAdmin('finance2@atp.test');
    await adm
      .post(`/v1/finance/payout-runs/${run.id}/approve`)
      .set('Idempotency-Key', idem())
      .expect(200);
    await second
      .post(`/v1/finance/payout-runs/${run.id}/approve`)
      .set('Idempotency-Key', idem())
      .expect(200);
    await t.settle();
    const done = (await adm.get(`/v1/finance/payout-runs/${run.id}`).expect(200)).body;
    expect(done.payouts[0].status).toBe('paid');

    // Suspended advisors, by contrast, are held back.
    await t.admin.query(`UPDATE identity.advisors SET status = 'suspended' WHERE id = $1`, [
      bob.advisorId,
    ]);
  });
});
