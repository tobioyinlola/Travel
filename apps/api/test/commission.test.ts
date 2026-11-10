import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { splitCommission } from '../src/modules/commission-payments/domain/split.js';
import { inDays, startApp, type TestApp } from './app-harness.js';

type Agent = ReturnType<typeof request.agent>;
interface Rate {
  rateKey: string;
  refundable: boolean;
  paymentModes: string[];
  commissionable: { amountMinor: string };
  commissionBps: number;
}

describe('commission, ledger and tiers (FR-COM-01..03, 05, 06, FR-MEM-05, AC-05, AC-06)', () => {
  let t: TestApp;
  let ada: { agent: Agent; advisorId: string };
  let clientId: string;

  beforeAll(async () => {
    t = await startApp();
    await t.ingestCatalog();
  });
  beforeEach(async () => {
    await t.reset();
    await t.ingestCatalog();
    ada = await t.onboardAdvisor('ada@example.com', { essentials: true });
    clientId = await newClient(ada.agent);
  });
  afterAll(() => t.close());

  const newClient = async (agent: Agent) =>
    (
      await agent
        .post('/v1/clients')
        .send({ firstName: 'Grace', lastName: 'Hopper', email: 'grace@example.com' })
        .expect(201)
    ).body.id as string;

  /** A booking confirmed through the real flow (pay at hotel, so no payment step), starting `startIn` days out. */
  async function confirmedBooking(agent: Agent = ada.agent, client = clientId, startIn = 60) {
    const from = inDays(startIn);
    const to = inDays(startIn + 3);
    const trip = (
      await agent
        .post('/v1/trips')
        .send({ clientId: client, title: 'Lisbon', startDate: from, endDate: to, adults: 2 })
        .expect(201)
    ).body;
    const rates: Rate[] = (
      await agent
        .get('/v1/catalog/search')
        .query({ destination: 'lisbon', checkIn: from, checkOut: to, adults: 2 })
        .expect(200)
    ).body.results.flatMap((r: { rates: Rate[] }) => r.rates);
    const rate = rates.find((r) => r.refundable && r.paymentModes.includes('pay_at_hotel'))!;
    await agent.post(`/v1/trips/${trip.id}/hotels`).send({ rateKey: rate.rateKey }).expect(201);
    const url = (
      await agent.post(`/v1/trips/${trip.id}/proposals`).send({ sendEmail: false }).expect(201)
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
      .set('Idempotency-Key', crypto.randomUUID())
      .send({
        traveler: { name: 'Grace Hopper', email: 'grace@example.com' },
        paymentMode: 'pay_at_hotel',
      })
      .expect(200);
    await t.settle();
    const booking = (await agent.get('/v1/bookings').query({ tripId: trip.id }).expect(200)).body
      .items[0];
    expect(booking.status).toBe('confirmed');
    return { booking, rate, tripId: trip.id as string };
  }

  const earnings = async (agent: Agent = ada.agent) =>
    (await agent.get('/v1/commissions').expect(200)).body;
  const trial = async () => {
    const adm = await t.admin1();
    return (await adm.get('/v1/finance/ledger/trial-balance').expect(200)).body as {
      balanced: boolean;
      accounts: Array<{ account: string; debit: string; credit: string; balance: string }>;
    };
  };
  const bal = (tb: Awaited<ReturnType<typeof trial>>, account: string) =>
    BigInt(tb.accounts.find((a) => a.account === account)?.balance ?? '0');

  it('recognises commission on confirmation and splits it by tier (FR-COM-01, 02)', async () => {
    const { rate } = await confirmedBooking();
    const e = await earnings();
    expect(e.items).toHaveLength(1);
    const c = e.items[0];
    const want = splitCommission({
      commissionableMinor: BigInt(rate.commissionable.amountMinor),
      rateBps: rate.commissionBps,
      advisorShareBps: 7000,
    });
    expect(c).toMatchObject({
      status: 'expected',
      tier: 'starter',
      advisorShareBps: 7000,
      expected: { amountMinor: String(want.expectedMinor) },
      advisorShare: { amountMinor: String(want.advisorMinor) },
    });
    expect(e.totals.pending.amountMinor).toBe(String(want.advisorMinor));

    // Ledger: receivable = whole commission; revenue and pending-liability are credits that add up to it.
    const tb = await trial();
    expect(tb.balanced).toBe(true);
    expect(bal(tb, 'supplier_receivable')).toBe(want.expectedMinor);
    expect(bal(tb, 'platform_revenue')).toBe(-want.platformMinor);
    expect(bal(tb, 'advisor_commission_pending')).toBe(-want.advisorMinor);
  });

  it('attaches partner perks to a confirmed booking (FR-PRT-02)', async () => {
    const adm = await t.admin1();
    const results: Array<{ property: { id: string; name: string }; rates: Rate[] }> = (
      await ada.agent
        .get('/v1/catalog/search')
        .query({ destination: 'lisbon', checkIn: inDays(60), checkOut: inDays(63), adults: 2 })
        .expect(200)
    ).body.results;
    // The same hotel the booking helper will pick (first refundable, pay-at-hotel offer).
    const target = results.find((r) =>
      r.rates.some((x) => x.refundable && x.paymentModes.includes('pay_at_hotel')),
    )!;
    const supplier = (
      await adm
        .post('/v1/admin/partners/suppliers')
        .send({ name: 'Harbour Hotels Group', type: 'hotel_group' })
        .expect(201)
    ).body;
    await adm
      .post('/v1/admin/partners/programs')
      .send({
        supplierId: supplier.id,
        name: 'Harbour Preferred',
        tier: 'preferred',
        perks: [{ kind: 'breakfast', description: 'Daily breakfast for two' }],
        rateCodes: [],
        propertyIds: [target.property.id],
      })
      .expect(201);
    await t.settle();

    const { booking } = await confirmedBooking();
    expect(booking.lines[0].propertyName).toBe(target.property.name);
    const got = (await ada.agent.get(`/v1/partners/booking-perks/${booking.id}`).expect(200)).body
      .items;
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({
      programName: 'Harbour Preferred',
      perks: [{ kind: 'breakfast' }],
    });
    expect(got[0].lineId).toBe(booking.lines[0].id);
    const bob = await t.onboardAdvisor('bob@example.com', { essentials: true });
    expect(
      (await bob.agent.get(`/v1/partners/booking-perks/${booking.id}`).expect(200)).body.items,
    ).toEqual([]);
  });

  it('an advisor sees only their own commissions (row-level security)', async () => {
    await confirmedBooking();
    const bob = await t.onboardAdvisor('bob@example.com', { essentials: true });
    expect((await earnings(bob.agent)).items).toHaveLength(0);
    await bob.agent
      .post('/v1/finance/commissions/00000000-0000-7000-8000-000000000000/release')
      .set('Idempotency-Key', crypto.randomUUID())
      .expect(403);
    await ada.agent.get('/v1/finance/ledger/trial-balance').expect(403);
  });

  it('the advisor share becomes payable only when finance records the supplier payment (FR-COM-05)', async () => {
    await confirmedBooking();
    const adm = await t.admin1();
    const c = (await earnings()).items[0];
    expect((await earnings()).totals.payable.amountMinor).toBe('0');

    const res = await adm
      .post(`/v1/finance/commissions/${c.id}/release`)
      .set('Idempotency-Key', crypto.randomUUID())
      .expect(200);
    expect(res.body.status).toBe('payable');
    const after = await earnings();
    expect(after.totals).toMatchObject({ payable: c.advisorShare, pending: { amountMinor: '0' } });

    const tb = await trial();
    expect(tb.balanced).toBe(true);
    expect(bal(tb, 'supplier_receivable')).toBe(0n);
    expect(bal(tb, 'advisor_commission_pending')).toBe(0n);
    expect(bal(tb, 'advisor_payable')).toBe(-BigInt(c.advisorShare.amountMinor));
    expect(bal(tb, 'cash_clearing')).toBe(BigInt(c.expected.amountMinor));
    await adm
      .post(`/v1/finance/commissions/${c.id}/release`)
      .set('Idempotency-Key', crypto.randomUUID())
      .expect(409);
  });

  it('cancelling reverses the commission with opposite entries, before or after the supplier paid (FR-COM-06)', async () => {
    const first = await confirmedBooking();
    const second = await confirmedBooking(ada.agent, clientId, 80);
    const adm = await t.admin1();
    const items = (await earnings()).items as Array<{ id: string; bookingId: string }>;
    const paidOne = items.find((i) => i.bookingId === second.booking.id)!;
    await adm
      .post(`/v1/finance/commissions/${paidOne.id}/release`)
      .set('Idempotency-Key', crypto.randomUUID())
      .expect(200);

    for (const b of [first.booking, second.booking]) {
      await ada.agent
        .post(`/v1/bookings/${b.id}/cancel`)
        .set('Idempotency-Key', crypto.randomUUID())
        .send({ reason: 'Traveler cancelled' })
        .expect(200);
    }
    await t.settle();
    const after = await earnings();
    expect(after.items.map((i: { status: string }) => i.status)).toEqual(['reversed', 'reversed']);
    expect(after.totals).toMatchObject({
      pending: { amountMinor: '0' },
      payable: { amountMinor: '0' },
    });

    const tb = await trial();
    expect(tb.balanced).toBe(true);
    for (const a of [
      'supplier_receivable',
      'platform_revenue',
      'advisor_commission_pending',
      'advisor_payable',
      'cash_clearing',
    ])
      expect(bal(tb, a), a).toBe(0n);
    // Original postings are untouched: reversals are extra, opposite entries.
    const n = (
      await t.admin.query(
        `SELECT count(*)::int AS n FROM commission.ledger_txns WHERE kind = 'reversal'`,
      )
    ).rows[0].n;
    expect(n).toBe(2);
  });

  it('AC-06: reaching $300K upgrades the tier for later sales only (prospective)', async () => {
    // $299,900 of commissionable sales already this year.
    await t.admin.query(
      `INSERT INTO membership.advisor_sales (advisor_id, year, currency, commissionable_minor, tier_code)
       VALUES ($1, $2, 'USD', 29990000, 'starter')`,
      [ada.advisorId, new Date().getUTCFullYear()],
    );
    const crossing = await confirmedBooking();
    // Commissionable on one stay is a few hundred dollars: this is the sale that crosses $300K.
    expect(BigInt(crossing.rate.commissionable.amountMinor)).toBeGreaterThan(10_000n);
    const afterFirst = (await ada.agent.get('/v1/commissions/tier').expect(200)).body;
    expect(afterFirst).toMatchObject({ tier: 'pro', advisorShareBps: 7500 });
    expect(afterFirst.next?.code).toBe('elite');

    const later = await confirmedBooking(ada.agent, clientId, 80);
    const items = (await earnings()).items as Array<{
      bookingId: string;
      tier: string;
      advisorShareBps: number;
    }>;
    const a = items.find((i) => i.bookingId === crossing.booking.id)!;
    const b = items.find((i) => i.bookingId === later.booking.id)!;
    expect(a).toMatchObject({ tier: 'starter', advisorShareBps: 7000 }); // the crossing sale keeps the old split
    expect(b).toMatchObject({ tier: 'pro', advisorShareBps: 7500 }); // the next one gets the new one
  });

  it('a cancellation can move the tier back down', async () => {
    await t.admin.query(
      `INSERT INTO membership.advisor_sales (advisor_id, year, currency, commissionable_minor, tier_code)
       VALUES ($1, $2, 'USD', 29990000, 'starter')`,
      [ada.advisorId, new Date().getUTCFullYear()],
    );
    const { booking } = await confirmedBooking();
    expect((await ada.agent.get('/v1/commissions/tier').expect(200)).body.tier).toBe('pro');
    await ada.agent
      .post(`/v1/bookings/${booking.id}/cancel`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ reason: 'Traveler cancelled' })
      .expect(200);
    await t.settle();
    expect((await ada.agent.get('/v1/commissions/tier').expect(200)).body.tier).toBe('starter');
  });

  it('the ledger is append-only and every transaction must balance', async () => {
    await confirmedBooking();
    await expect(
      t.admin.query(`UPDATE commission.ledger_entries SET amount_minor = 1`),
    ).rejects.toThrow(/append-only/);
    await expect(t.admin.query(`DELETE FROM commission.ledger_entries`)).rejects.toThrow(
      /append-only/,
    );
    await expect(t.admin.query(`DELETE FROM commission.ledger_txns`)).rejects.toThrow(
      /append-only/,
    );

    const c = await t.admin.connect();
    try {
      await c.query('BEGIN');
      await c.query(
        `INSERT INTO commission.ledger_txns (id, kind, ref_type, ref_id, description, currency)
         VALUES ('01960000-0000-7000-8000-0000000000aa', 'test', 'test', '01960000-0000-7000-8000-0000000000aa', 't', 'USD')`,
      );
      await c.query(
        `INSERT INTO commission.ledger_entries (txn_id, account, direction, amount_minor, currency)
         VALUES ('01960000-0000-7000-8000-0000000000aa', 'cash_clearing', 'debit', 100, 'USD')`,
      );
      await expect(c.query('COMMIT')).rejects.toThrow(/Unbalanced ledger transaction/);
    } finally {
      await c.query('ROLLBACK').catch(() => undefined);
      c.release();
    }
  });
});
