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

  const major = (minor: string | bigint) => {
    const v = BigInt(minor);
    return `${v / 100n}.${String(v % 100n).padStart(2, '0')}`;
  };
  /** Finance imports a statement in which the supplier pays this booking's commission (default: exactly as expected). */
  async function supplierPays(
    booking: { lines: Array<{ supplier: string; confirmationCode: string }> },
    expected: string,
    paid = expected,
  ) {
    const adm = await t.admin1();
    return await adm
      .post('/v1/finance/statements')
      .set('Idempotency-Key', crypto.randomUUID())
      .send({
        supplier: booking.lines[0]!.supplier,
        reference: `ST-${Math.random().toString(36).slice(2, 8)}`,
        lines: [{ confirmationCode: booking.lines[0]!.confirmationCode, amount: major(paid) }],
      })
      .expect(201);
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
      .post('/v1/finance/statements')
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ supplier: 'x', reference: 'y', lines: [{ confirmationCode: 'A', amount: '1' }] })
      .expect(403);
    await ada.agent.get('/v1/finance/ledger/trial-balance').expect(403);
  });

  it('the advisor share becomes payable only when the supplier statement pays it (FR-COM-05)', async () => {
    const { booking } = await confirmedBooking();
    const c = (await earnings()).items[0];
    expect((await earnings()).totals.payable.amountMinor).toBe('0');

    const res = await supplierPays(booking, c.expected.amountMinor);
    expect(res.body).toMatchObject({ matched: 1, mismatch: 0, unmatched: 0 });
    expect((await earnings()).items[0].status).toBe('payable');
    const after = await earnings();
    expect(after.totals).toMatchObject({ payable: c.advisorShare, pending: { amountMinor: '0' } });

    const tb = await trial();
    expect(tb.balanced).toBe(true);
    expect(bal(tb, 'supplier_receivable')).toBe(0n);
    expect(bal(tb, 'advisor_commission_pending')).toBe(0n);
    expect(bal(tb, 'advisor_payable')).toBe(-BigInt(c.advisorShare.amountMinor));
    expect(bal(tb, 'cash_clearing')).toBe(BigInt(c.expected.amountMinor));
    // The same payment cannot settle it twice: a second statement line for it is unmatched.
    const again = await supplierPays(booking, c.expected.amountMinor);
    expect(again.body).toMatchObject({ matched: 0, unmatched: 1 });
    expect((await earnings()).totals.payable).toEqual(c.advisorShare);
  });

  it('cancelling reverses the commission with opposite entries, before or after the supplier paid (FR-COM-06)', async () => {
    const first = await confirmedBooking();
    const second = await confirmedBooking(ada.agent, clientId, 80);
    const items = (await earnings()).items as Array<{
      bookingId: string;
      expected: { amountMinor: string };
    }>;
    const paidOne = items.find((i) => i.bookingId === second.booking.id)!;
    await supplierPays(second.booking, paidOne.expected.amountMinor);

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

  it('flags a variance, and finance decides: accept books the difference to the platform, reject leaves it open', async () => {
    const a = await confirmedBooking();
    const b = await confirmedBooking(ada.agent, clientId, 80);
    const items = (await earnings()).items as Array<{
      id: string;
      bookingId: string;
      expected: { amountMinor: string };
      advisorShare: { amountMinor: string };
    }>;
    const ia = items.find((i) => i.bookingId === a.booking.id)!;
    const ib = items.find((i) => i.bookingId === b.booking.id)!;
    const underpaid = BigInt(ia.expected.amountMinor) - 500n;
    const overpaid = BigInt(ib.expected.amountMinor) + 300n;
    expect(
      (await supplierPays(a.booking, ia.expected.amountMinor, String(underpaid))).body,
    ).toMatchObject({ mismatch: 1 });
    expect(
      (await supplierPays(b.booking, ib.expected.amountMinor, String(overpaid))).body,
    ).toMatchObject({ mismatch: 1 });
    expect((await earnings()).items.every((i: { status: string }) => i.status === 'expected')).toBe(
      true,
    );

    const adm = await t.admin1();
    const lines = (
      await adm.get('/v1/finance/statement-lines').query({ status: 'mismatch' }).expect(200)
    ).body.items as Array<{ id: string; variance: { amountMinor: string }; commissionId: string }>;
    expect(lines.map((l) => l.variance.amountMinor).sort()).toEqual(['-500', '300']);
    const under = lines.find((l) => l.variance.amountMinor === '-500')!;
    const over = lines.find((l) => l.variance.amountMinor === '300')!;
    await adm
      .post(`/v1/finance/statement-lines/${under.id}/resolve`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ decision: 'accept', note: 'Supplier fee' })
      .expect(200);
    await adm
      .post(`/v1/finance/statement-lines/${over.id}/resolve`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ decision: 'reject', note: 'Query with supplier' })
      .expect(200);

    const after = (await earnings()).items as Array<{
      id: string;
      status: string;
      advisorShare: { amountMinor: string };
    }>;
    expect(after.find((i) => i.id === ia.id)).toMatchObject({
      status: 'payable',
      advisorShare: ia.advisorShare,
    });
    expect(after.find((i) => i.id === ib.id)!.status).toBe('expected');
    const tb = await trial();
    expect(tb.balanced).toBe(true);
    const rep = (await adm.get('/v1/finance/reconciliation').expect(200)).body;
    expect(rep).toMatchObject({
      ledgerBalanced: true,
      receivableVarianceMinor: '0',
      ok: true,
      openMismatches: 0,
    });
    await adm
      .post(`/v1/finance/statement-lines/${under.id}/resolve`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ decision: 'accept', note: 'again' })
      .expect(409);
  });

  it('reports lines it cannot match, refuses a repeated statement and a malformed one', async () => {
    const adm = await t.admin1();
    const body = {
      supplier: 'fake-wholesaler-a',
      reference: 'ST-1',
      lines: [{ confirmationCode: 'NOSUCH1', amount: '10.00' }],
    };
    const res = await adm
      .post('/v1/finance/statements')
      .set('Idempotency-Key', crypto.randomUUID())
      .send(body)
      .expect(201);
    expect(res.body).toMatchObject({ matched: 0, unmatched: 1 });
    const unmatched = (
      await adm.get('/v1/finance/statement-lines').query({ status: 'unmatched' }).expect(200)
    ).body.items;
    expect(unmatched[0]).toMatchObject({
      confirmationCode: 'NOSUCH1',
      note: expect.stringContaining('No booking'),
    });
    await adm
      .post('/v1/finance/statements')
      .set('Idempotency-Key', crypto.randomUUID())
      .send(body)
      .expect(409);
    await adm
      .post('/v1/finance/statements')
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ ...body, reference: 'ST-2', lines: undefined, csv: 'AB,notmoney' })
      .expect(422);
    expect((await adm.get('/v1/finance/statements').expect(200)).body.items).toHaveLength(1);
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
