import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { FakePayoutProvider, PAYOUT_PROVIDER } from '../src/modules/commission-payments/index.js';
import { inDays, startApp, type TestApp } from './app-harness.js';

type Agent = ReturnType<typeof request.agent>;
interface Rate {
  rateKey: string;
  refundable: boolean;
  paymentModes: string[];
}

describe('payouts (FR-COM-07, 09, FR-COM-08, AC-07, AC-08)', () => {
  let t: TestApp;
  let ada: { agent: Agent; advisorId: string };
  let clientId: string;
  let fin1: Agent;
  let fin2: Agent;
  let provider: FakePayoutProvider;
  const idem = () => crypto.randomUUID();

  beforeAll(async () => {
    t = await startApp();
    provider = t.app.get<FakePayoutProvider>(PAYOUT_PROVIDER);
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
    fin1 = await t.admin1();
    fin2 = await t.signInAdmin('finance2@atp.test');
  });
  afterAll(() => t.close());

  const major = (minor: string | bigint) => {
    const v = BigInt(minor);
    return `${v / 100n}.${String(v % 100n).padStart(2, '0')}`;
  };

  async function confirmedBooking(startIn = 60) {
    const from = inDays(startIn);
    const to = inDays(startIn + 3);
    const trip = (
      await ada.agent
        .post('/v1/trips')
        .send({ clientId, title: 'Lisbon', startDate: from, endDate: to, adults: 2 })
        .expect(201)
    ).body;
    const rates: Rate[] = (
      await ada.agent
        .get('/v1/catalog/search')
        .query({ destination: 'lisbon', checkIn: from, checkOut: to, adults: 2 })
        .expect(200)
    ).body.results.flatMap((r: { rates: Rate[] }) => r.rates);
    const rate = rates.find((r) => r.refundable && r.paymentModes.includes('pay_at_hotel'))!;
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
    await t
      .http()
      .post(`/v1/checkout/${token}/confirm`)
      .set('Idempotency-Key', idem())
      .send({
        traveler: { name: 'Grace Hopper', email: 'grace@example.com' },
        paymentMode: 'pay_at_hotel',
      })
      .expect(200);
    await t.settle();
    return (await ada.agent.get('/v1/bookings').query({ tripId: trip.id }).expect(200)).body
      .items[0] as {
      id: string;
      lines: Array<{ supplier: string; confirmationCode: string }>;
    };
  }

  const earnings = async () => (await ada.agent.get('/v1/commissions').expect(200)).body;
  const commissionOf = async (bookingId: string) =>
    (await earnings()).items.find((i: { bookingId: string }) => i.bookingId === bookingId);

  /** The supplier pays this booking's commission exactly as expected (via a statement). */
  async function supplierPays(booking: {
    id: string;
    lines: Array<{ supplier: string; confirmationCode: string }>;
  }) {
    const c = await commissionOf(booking.id);
    await fin1
      .post('/v1/finance/statements')
      .set('Idempotency-Key', idem())
      .send({
        supplier: booking.lines[0]!.supplier,
        reference: `ST-${Math.random().toString(36).slice(2, 8)}`,
        lines: [
          {
            confirmationCode: booking.lines[0]!.confirmationCode,
            amount: major(c.expected.amountMinor),
          },
        ],
      })
      .expect(201);
    return c;
  }

  const setAccount = (ref = 'acct_fake_ada') =>
    ada.agent.put('/v1/payouts/account').send({ accountRef: ref, country: 'NG' }).expect(200);
  const createRun = async () =>
    (await fin1.post('/v1/finance/payout-runs').set('Idempotency-Key', idem()).expect(201)).body;
  const approveBoth = async (runId: string) => {
    await fin1
      .post(`/v1/finance/payout-runs/${runId}/approve`)
      .set('Idempotency-Key', idem())
      .expect(200);
    return (
      await fin2
        .post(`/v1/finance/payout-runs/${runId}/approve`)
        .set('Idempotency-Key', idem())
        .expect(200)
    ).body;
  };
  const trial = async () =>
    (await fin1.get('/v1/finance/ledger/trial-balance').expect(200)).body as {
      balanced: boolean;
      accounts: Array<{ account: string; balance: string }>;
    };
  const bal = (tb: Awaited<ReturnType<typeof trial>>, a: string) =>
    BigInt(tb.accounts.find((x) => x.account === a)?.balance ?? '0');
  const retryDueNow = async () => {
    await t.admin.query('UPDATE graphile_worker._private_jobs SET run_at = now()');
    await t.settle();
  };

  it('pays an eligible advisor after two different people approve, and itemises it (AC-07, FR-COM-07/08)', async () => {
    const booking = await confirmedBooking();
    const c = await supplierPays(booking);
    await setAccount();
    const mine = (await ada.agent.get('/v1/payouts').expect(200)).body;
    expect(mine).toMatchObject({ eligible: true, blockers: [], payable: c.advisorShare });

    const run = await createRun();
    expect(run.payouts).toHaveLength(1);
    expect(run.payouts[0]).toMatchObject({
      status: 'pending',
      gross: c.advisorShare,
      net: c.advisorShare,
    });

    // One approval is not enough, and the same person cannot approve twice.
    await fin1
      .post(`/v1/finance/payout-runs/${run.id}/approve`)
      .set('Idempotency-Key', idem())
      .expect(200);
    await t.settle();
    expect(provider.calls).toHaveLength(0);
    await fin1
      .post(`/v1/finance/payout-runs/${run.id}/approve`)
      .set('Idempotency-Key', idem())
      .expect(409);
    const approved = (
      await fin2
        .post(`/v1/finance/payout-runs/${run.id}/approve`)
        .set('Idempotency-Key', idem())
        .expect(200)
    ).body;
    expect(approved.status).toBe('approved');
    await t.settle();

    const after = (await fin1.get(`/v1/finance/payout-runs/${run.id}`).expect(200)).body;
    expect(after).toMatchObject({ status: 'completed', totalPaid: c.advisorShare });
    expect(provider.calls).toHaveLength(1);
    expect(provider.calls[0]).toMatchObject({
      accountRef: 'acct_fake_ada',
      idempotencyKey: after.payouts[0].id,
    });

    const stmt = (await ada.agent.get('/v1/payouts').expect(200)).body;
    expect(stmt.payable.amountMinor).toBe('0');
    expect(stmt.payouts[0]).toMatchObject({ status: 'paid', net: c.advisorShare });
    expect(stmt.payouts[0].lines[0].commissionId).toBe(c.id);
    expect((await commissionOf(booking.id)).status).toBe('paid');
    expect((await earnings()).totals.paid).toEqual(c.advisorShare);

    const tb = await trial();
    expect(tb.balanced).toBe(true);
    expect(bal(tb, 'advisor_payable')).toBe(0n);
    expect(bal(tb, 'cash_clearing')).toBe(
      BigInt(c.expected.amountMinor) - BigInt(c.advisorShare.amountMinor),
    );
    expect(
      t.mail.sent.filter((m) => m.to === 'ada@example.com' && /payout/i.test(m.subject)),
    ).toHaveLength(1);
    // The same advisor is not paid twice: the next run has nobody to pay.
    expect((await createRun()).payouts).toHaveLength(0);
  });

  it('only finance and admin can run payouts, and an advisor sees only their own', async () => {
    await ada.agent.post('/v1/finance/payout-runs').set('Idempotency-Key', idem()).expect(403);
    await ada.agent
      .post('/v1/finance/adjustments')
      .set('Idempotency-Key', idem())
      .send({ advisorId: ada.advisorId, amountMinor: '100', reasonCode: 'goodwill', note: 'x y z' })
      .expect(403);
    const bob = await t.onboardAdvisor('bob@example.com', { essentials: true });
    expect((await bob.agent.get('/v1/payouts').expect(200)).body.payouts).toEqual([]);
    await bob.agent
      .put('/v1/payouts/account')
      .send({ accountRef: 'not a token', country: 'NG' })
      .expect(400);
  });

  it('AC-07: the gate holds back advisors without a payout account, on hold, not active, or below the minimum', async () => {
    const booking = await confirmedBooking();
    await supplierPays(booking);

    let run = await createRun();
    expect(run.payouts[0]).toMatchObject({ status: 'skipped', skipReason: 'no_payout_account' });
    await fin1.post(`/v1/finance/payout-runs/${run.id}/cancel`).expect(200);

    await setAccount();
    await fin1
      .post(`/v1/finance/advisors/${ada.advisorId}/hold`)
      .send({ reason: 'Chargeback review' })
      .expect(200);
    await fin1
      .post(`/v1/finance/advisors/${ada.advisorId}/hold`)
      .send({ reason: 'again' })
      .expect(409);
    run = await createRun();
    expect(run.payouts[0].skipReason).toBe('on_hold');
    await fin1.post(`/v1/finance/payout-runs/${run.id}/cancel`).expect(200);

    await fin1
      .post(`/v1/finance/advisors/${ada.advisorId}/hold/release`)
      .send({ note: 'Cleared' })
      .expect(200);
    await t.admin.query(`UPDATE identity.advisors SET status = 'suspended' WHERE id = $1`, [
      ada.advisorId,
    ]);
    run = await createRun();
    expect(run.payouts[0].skipReason).toBe('not_active');
    await fin1.post(`/v1/finance/payout-runs/${run.id}/cancel`).expect(200);
    await t.admin.query(`UPDATE identity.advisors SET status = 'active' WHERE id = $1`, [
      ada.advisorId,
    ]);

    // Below the $10 minimum: take most of the balance back with an adjustment.
    const c = await commissionOf(booking.id);
    await fin1
      .post('/v1/finance/adjustments')
      .set('Idempotency-Key', idem())
      .send({
        advisorId: ada.advisorId,
        amountMinor: String(-(BigInt(c.advisorShare.amountMinor) - 500n)),
        reasonCode: 'correction',
        note: 'Test',
      })
      .expect(201);
    run = await createRun();
    expect(run.payouts[0].skipReason).toBe('below_minimum');
    expect(provider.calls).toHaveLength(0);
  });

  it('AC-07: the gate is checked again right before money moves', async () => {
    const booking = await confirmedBooking();
    await supplierPays(booking);
    await setAccount();
    const run = await createRun();
    await fin1
      .post(`/v1/finance/payout-runs/${run.id}/approve`)
      .set('Idempotency-Key', idem())
      .expect(200);
    // Approved by the second person, but a hold lands before the job runs.
    await fin1
      .post(`/v1/finance/advisors/${ada.advisorId}/hold`)
      .send({ reason: 'Fraud signal' })
      .expect(200);
    await fin2
      .post(`/v1/finance/payout-runs/${run.id}/approve`)
      .set('Idempotency-Key', idem())
      .expect(200);
    await t.settle();
    const after = (await fin1.get(`/v1/finance/payout-runs/${run.id}`).expect(200)).body;
    expect(after.payouts[0]).toMatchObject({ status: 'skipped', skipReason: 'on_hold' });
    expect(provider.calls).toHaveLength(0);
    expect((await commissionOf(booking.id)).status).toBe('payable');
  });

  it('AC-08: a cancelled booking that was already paid is taken from the next payout', async () => {
    const first = await confirmedBooking();
    const firstC = await supplierPays(first);
    await setAccount();
    await approveBoth((await createRun()).id);
    await t.settle();
    expect((await commissionOf(first.id)).status).toBe('paid');

    // The traveler cancels after the advisor was paid.
    await ada.agent
      .post(`/v1/bookings/${first.id}/cancel`)
      .set('Idempotency-Key', idem())
      .send({ reason: 'Traveler cancelled' })
      .expect(200);
    await t.settle();
    expect((await commissionOf(first.id)).status).toBe('reversed');
    const owing = (await ada.agent.get('/v1/payouts').expect(200)).body;
    expect(owing.openDebt).toEqual(firstC.advisorShare);
    const tb = await trial();
    expect(tb.balanced).toBe(true);
    expect(bal(tb, 'advisor_receivable')).toBe(BigInt(firstC.advisorShare.amountMinor));

    // A new sale is paid by the supplier; the next run deducts the debt.
    const second = await confirmedBooking(80);
    const secondC = await supplierPays(second);
    const run = await createRun();
    const gross = BigInt(secondC.advisorShare.amountMinor);
    const debt = BigInt(firstC.advisorShare.amountMinor);
    const applied = debt < gross ? debt : gross;
    expect(run.payouts[0]).toMatchObject({
      gross: { amountMinor: String(gross) },
      debtApplied: { amountMinor: String(applied) },
      net: { amountMinor: String(gross - applied) },
    });
    const callsBefore = provider.calls.length;
    await approveBoth(run.id);
    await t.settle();
    expect(provider.calls.length).toBe(gross - applied > 0n ? callsBefore + 1 : callsBefore);
    const after = (await ada.agent.get('/v1/payouts').expect(200)).body;
    expect(BigInt(after.openDebt.amountMinor)).toBe(debt - applied);
    const tb2 = await trial();
    expect(tb2.balanced).toBe(true);
    expect(bal(tb2, 'advisor_receivable')).toBe(debt - applied);
  });

  it('when the debt is larger than what is owed, nothing is sent and the rest carries over', async () => {
    const first = await confirmedBooking();
    const firstC = await supplierPays(first);
    await setAccount();
    await approveBoth((await createRun()).id);
    await t.settle();
    await ada.agent
      .post(`/v1/bookings/${first.id}/cancel`)
      .set('Idempotency-Key', idem())
      .send({ reason: 'Traveler cancelled' })
      .expect(200);
    await t.settle();
    const second = await confirmedBooking(80);
    await supplierPays(second);
    const c2 = await commissionOf(second.id);
    const debt = BigInt(firstC.advisorShare.amountMinor);
    // Leave exactly $11 owed (above the $10 minimum, below the debt) by taking the rest back.
    const gross = 1100n;
    await fin1
      .post('/v1/finance/adjustments')
      .set('Idempotency-Key', idem())
      .send({
        advisorId: ada.advisorId,
        amountMinor: String(-(BigInt(c2.advisorShare.amountMinor) - gross)),
        reasonCode: 'correction',
        note: 'Shrink balance',
      })
      .expect(201);
    expect(debt).toBeGreaterThan(gross);
    const run = await createRun();
    expect(run.payouts[0]).toMatchObject({
      debtApplied: { amountMinor: String(gross) },
      net: { amountMinor: '0' },
    });
    const calls = provider.calls.length;
    await approveBoth(run.id);
    await t.settle();
    expect(provider.calls.length).toBe(calls);
    expect(
      (await fin1.get(`/v1/finance/payout-runs/${run.id}`).expect(200)).body.payouts[0].status,
    ).toBe('paid');
    expect(BigInt((await ada.agent.get('/v1/payouts').expect(200)).body.openDebt.amountMinor)).toBe(
      debt - gross,
    );
  });

  it('a refused payout fails cleanly: the balance is untouched and the next run can retry', async () => {
    const booking = await confirmedBooking();
    await supplierPays(booking);
    await setAccount('acct_fake_closed');
    const run = await createRun();
    await approveBoth(run.id);
    await t.settle();
    const after = (await fin1.get(`/v1/finance/payout-runs/${run.id}`).expect(200)).body;
    expect(after.status).toBe('completed');
    expect(after.payouts[0]).toMatchObject({ status: 'failed', failureReason: 'account_closed' });
    expect((await commissionOf(booking.id)).status).toBe('payable');
    expect((await ada.agent.get('/v1/payouts').expect(200)).body.payable.amountMinor).not.toBe('0');
    expect(
      await t.admin
        .query(`SELECT 1 FROM commission.ledger_txns WHERE kind = 'payout'`)
        .then((r) => r.rowCount),
    ).toBe(0);

    await setAccount('acct_fake_ada');
    const again = await createRun();
    await approveBoth(again.id);
    await t.settle();
    expect((await commissionOf(booking.id)).status).toBe('paid');
  });

  it('retries a payout after a transport error with the same idempotency key', async () => {
    const booking = await confirmedBooking();
    await supplierPays(booking);
    await setAccount();
    provider.transportFailures = 1;
    const run = await createRun();
    await approveBoth(run.id);
    await t.settle();
    expect((await commissionOf(booking.id)).status).toBe('payable');
    await retryDueNow();
    expect((await commissionOf(booking.id)).status).toBe('paid');
    expect(provider.calls).toHaveLength(2);
    expect(new Set(provider.calls.map((c) => c.idempotencyKey)).size).toBe(1);
    expect(
      await t.admin
        .query(`SELECT 1 FROM commission.ledger_txns WHERE kind = 'payout'`)
        .then((r) => r.rowCount),
    ).toBe(1);
  });

  it('adjustments move the advisor payable with a reason code, and one run is open at a time', async () => {
    await fin1
      .post('/v1/finance/adjustments')
      .set('Idempotency-Key', idem())
      .send({ advisorId: ada.advisorId, amountMinor: '0', reasonCode: 'goodwill', note: 'zero' })
      .expect(422);
    await fin1
      .post('/v1/finance/adjustments')
      .set('Idempotency-Key', idem())
      .send({
        advisorId: ada.advisorId,
        amountMinor: '2500',
        reasonCode: 'goodwill',
        note: 'Apology for a delay',
      })
      .expect(201);
    await setAccount();
    expect((await ada.agent.get('/v1/payouts').expect(200)).body.payable.amountMinor).toBe('2500');
    const tb = await trial();
    expect(tb.balanced).toBe(true);
    expect(bal(tb, 'advisor_payable')).toBe(-2500n);
    expect(bal(tb, 'platform_revenue')).toBe(2500n);
    const run = await createRun();
    await fin1.post('/v1/finance/payout-runs').set('Idempotency-Key', idem()).expect(409);
    await fin1.post(`/v1/finance/payout-runs/${run.id}/cancel`).expect(200);
    await fin1
      .post(`/v1/finance/payout-runs/${run.id}/approve`)
      .set('Idempotency-Key', idem())
      .expect(409);
    const audit = await t.admin.query(
      `SELECT 1 FROM audit.log WHERE action = 'payout.adjustment' AND entity_id = $1`,
      [ada.advisorId],
    );
    expect(audit.rowCount).toBeGreaterThan(0);
  });
});
