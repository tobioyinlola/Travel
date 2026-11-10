import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { fakePaymentWebhookRequest } from '../src/modules/commission-payments/infrastructure/fake-payment-provider.js';
import { LiveStatusService } from '../src/modules/booking/application/live-status.service.js';
import { inDays, startApp, type TestApp } from './app-harness.js';

type Agent = ReturnType<typeof request.agent>;
interface Rate {
  rateKey: string;
  refundable: boolean;
  paymentModes: string[];
  total: { amountMinor: string };
  checkIn: string;
  checkOut: string;
}

async function until(cond: () => boolean, ms = 3000): Promise<void> {
  const end = Date.now() + ms;
  while (!cond()) {
    if (Date.now() > end) throw new Error('timed out waiting');
    await new Promise((r) => setTimeout(r, 25));
  }
}

const CARD_OK = '4242 4242 4242 4242';
const CARD_DECLINED = '4000 0000 0000 0002';
const traveler = { name: 'Grace Hopper', email: 'grace@example.com', phone: '+1 555 0100' };

describe('booking and payments (FR-BKG-01..06, FR-PAY-01/02, AC-02..AC-04)', () => {
  let t: TestApp;
  let ada: { agent: Agent; advisorId: string };
  let clientId: string;
  const start = inDays(60);
  const mid = inDays(63);
  const end = inDays(67);

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

  async function rates(agent: Agent, checkIn: string, checkOut: string): Promise<Rate[]> {
    const res = (
      await agent
        .get('/v1/catalog/search')
        .query({ destination: 'lisbon', checkIn, checkOut, adults: 2 })
        .expect(200)
    ).body;
    return res.results.flatMap((r: { rates: Rate[] }) => r.rates);
  }

  const refundable = (r: Rate) => r.refundable && r.paymentModes.includes('pay_at_hotel');
  const nonRefundable = (r: Rate) => !r.refundable;
  const withDeposit = (r: Rate) => r.paymentModes.includes('deposit');
  const anyRate = (r: Rate) => r.paymentModes.includes('prepay');

  /** A trip with the given hotel stays, published, and approved by the traveler through the link. */
  async function approvedTrip(
    stays: Array<{ from: string; to: string; pick: (r: Rate) => boolean }> = [
      { from: start, to: mid, pick: refundable },
    ],
    agent: Agent = ada.agent,
    client: string = clientId,
  ) {
    const trip = (
      await agent
        .post('/v1/trips')
        .send({
          clientId: client,
          title: 'Lisbon week',
          startDate: start,
          endDate: stays.at(-1)!.to,
          adults: 2,
        })
        .expect(201)
    ).body;
    const chosen: Rate[] = [];
    for (const s of stays) {
      const rate = (await rates(agent, s.from, s.to)).find(s.pick);
      if (!rate) throw new Error('The fake catalog has no rate matching this test');
      await agent.post(`/v1/trips/${trip.id}/hotels`).send({ rateKey: rate.rateKey }).expect(201);
      chosen.push(rate);
    }
    const proposal = (
      await agent.post(`/v1/trips/${trip.id}/proposals`).send({ sendEmail: false }).expect(201)
    ).body.proposal as { url: string };
    const token = proposal.url.split('/p/')[1]!;
    await t
      .http()
      .post(`/v1/proposal-links/${token}/decision`)
      .send({ decision: 'approve', name: 'Grace Hopper' })
      .expect(200);
    await t.settle();
    return { tripId: trip.id as string, token, rates: chosen };
  }

  const checkout = async (token: string) =>
    (await t.http().get(`/v1/checkout/${token}`).expect(200)).body;

  const confirm = (token: string, paymentMode: string, key: string = crypto.randomUUID()) =>
    t
      .http()
      .post(`/v1/checkout/${token}/confirm`)
      .set('Idempotency-Key', key)
      .send({ traveler, paymentMode });

  const pay = (clientToken: string, cardNumber = CARD_OK) =>
    t.http().post(`/v1/dev/fake-payments/${clientToken}/pay`).send({ cardNumber });

  /** Confirm with a payment mode, wait for the payment request, pay by card, wait for suppliers. */
  async function submitAndPay(token: string, mode = 'prepay', card = CARD_OK) {
    await confirm(token, mode).expect(200);
    await t.settle();
    const view = await checkout(token);
    expect(view.payment.clientToken).toMatch(/^ptok_/);
    await pay(view.payment.clientToken, card).expect(200);
    await t.settle();
    return checkout(token);
  }

  const advisorBookings = async (agent: Agent = ada.agent, tripId?: string) =>
    (
      await agent
        .get('/v1/bookings')
        .query(tripId ? { tripId } : {})
        .expect(200)
    ).body.items;
  const bookingOf = async (tripId: string, agent: Agent = ada.agent) =>
    (await advisorBookings(agent, tripId))[0];
  const tripStatus = async (tripId: string) =>
    (await ada.agent.get(`/v1/trips/${tripId}`).expect(200)).body.status;
  const rows = async (sql: string, params: unknown[] = []) =>
    (await t.admin.query(sql, params)).rows;
  const reserveCalls = () => t.suppliers.flatMap((s) => s.reserveCalls);
  const mailTo = (to: string, subject: RegExp) =>
    t.mail.sent.filter((m) => m.to === to && subject.test(m.subject));

  /** Retried jobs wait out their backoff; make them due now, then run everything. */
  async function retryDueNow() {
    await t.admin.query('UPDATE graphile_worker._private_jobs SET run_at = now()');
    await t.settle();
  }

  it('prepares a draft booking when the traveler approves, offering only the payment modes the hotels allow', async () => {
    const {
      tripId,
      token,
      rates: [rate],
    } = await approvedTrip();
    const view = await checkout(token);
    expect(view.status).toBe('draft');
    expect(view.total).toEqual({ amountMinor: rate!.total.amountMinor, currency: 'USD' });
    expect(view.paymentOptions.map((o: { mode: string }) => o.mode)).toEqual(
      expect.arrayContaining(['pay_at_hotel', 'prepay']),
    );
    expect(
      view.paymentOptions.find((o: { mode: string }) => o.mode === 'pay_at_hotel').dueNow
        .amountMinor,
    ).toBe('0');
    // The traveler never sees suppliers, rate keys or commission.
    expect(JSON.stringify(view)).not.toMatch(/fake-wholesaler|rateKey|commission/i);
    expect((await bookingOf(tripId)).status).toBe('draft');
  });

  it('prepay: takes the payment, reserves every hotel and confirms (AC-02)', async () => {
    const {
      tripId,
      token,
      rates: [rate],
    } = await approvedTrip();
    const done = await submitAndPay(token);
    expect(done.status).toBe('confirmed');
    expect(done.lines[0].confirmationCode).toMatch(/^[0-9A-Z]{7}$/);
    expect(done.payment.state).toBe('captured');

    const b = await bookingOf(tripId);
    expect(b).toMatchObject({
      status: 'confirmed',
      paymentMode: 'prepay',
      paymentState: 'captured',
      paid: { amountMinor: rate!.total.amountMinor },
      traveler: { name: 'Grace Hopper', email: 'grace@example.com' },
    });
    expect(b.lines[0]).toMatchObject({
      status: 'confirmed',
      supplier: expect.stringMatching(/^fake-/),
    });
    expect(await tripStatus(tripId)).toBe('booked');

    // Both sides are told, with the confirmation number.
    const code = done.lines[0].confirmationCode;
    expect(mailTo('grace@example.com', /Your trip is booked/)[0]?.text).toContain(code);
    expect(mailTo('ada@example.com', /Booking confirmed/)).toHaveLength(1);
    // Stored card data: none, only references.
    const [p] = await rows('SELECT * FROM payments.payments');
    expect(Object.keys(p)).not.toContain('card_number');
    expect(p.status).toBe('captured');
  });

  it('AC-04: a repeated submit, a redelivered webhook and a retry never charge or book twice', async () => {
    const { token } = await approvedTrip();
    const key = crypto.randomUUID();
    const first = await confirm(token, 'prepay', key).expect(200);
    const again = await confirm(token, 'prepay', key).expect(200);
    expect(again.body).toEqual(first.body);
    expect(again.headers['idempotent-replayed']).toBe('true');
    await t.settle();
    // A different key while the first payment is open reuses it instead of opening a second.
    await confirm(token, 'prepay', crypto.randomUUID()).expect(200);
    await t.settle();
    expect(await rows('SELECT id FROM payments.payments')).toHaveLength(1);

    // The provider delivers the same "paid" event twice.
    const [p] = await rows('SELECT provider_ref, amount_minor, currency FROM payments.payments');
    const { body, headers } = fakePaymentWebhookRequest({
      type: 'payment.succeeded',
      intentRef: p.provider_ref,
      amountMinor: p.amount_minor,
      currency: p.currency,
    });
    const send = () =>
      t
        .http()
        .post('/webhooks/fake-payments')
        .set(headers)
        .set('content-type', 'application/json')
        .send(body);
    expect((await send().expect(200)).body.duplicate).toBe(false);
    expect((await send().expect(200)).body.duplicate).toBe(true);
    await t.settle();

    expect((await checkout(token)).status).toBe('confirmed');
    expect(reserveCalls()).toHaveLength(1);
    // Submitting again once confirmed is refused, not repeated.
    await confirm(token, 'prepay', crypto.randomUUID()).expect(409);
    expect(await rows('SELECT id FROM payments.payments')).toHaveLength(1);
  });

  it('rejects webhooks with a bad signature', async () => {
    const { body } = fakePaymentWebhookRequest({ type: 'payment.succeeded', intentRef: 'pi_x' });
    await t
      .http()
      .post('/webhooks/fake-payments')
      .set('x-fake-signature', 'deadbeef')
      .set('content-type', 'application/json')
      .send(body)
      .expect(401);
  });

  it('AC-03: refuses a stale price at checkout, tells the advisor once, and lets them reprice', async () => {
    const { tripId, token } = await approvedTrip();
    t.suppliers.forEach((s) => (s.priceEpoch = 3));
    const res = await confirm(token, 'prepay').expect(409);
    expect(res.body.type).toMatch(/price-changed$/);
    await confirm(token, 'prepay').expect(409);
    await t.settle();

    expect((await checkout(token)).status).toBe('draft');
    expect(await rows('SELECT id FROM payments.payments')).toHaveLength(0);
    expect(mailTo('ada@example.com', /could not check out/)).toHaveLength(1);

    // Discarding the draft reopens the trip; the old proposal is superseded.
    const b = await bookingOf(tripId);
    await ada.agent.delete(`/v1/bookings/${b.id}`).expect(204);
    await t.settle();
    expect(await tripStatus(tripId)).toBe('planning');
    expect(await advisorBookings(ada.agent, tripId)).toHaveLength(0);
    await t.http().get(`/v1/checkout/${token}`).expect(404);
    const [p] = await rows(`SELECT status FROM itineraries.proposals WHERE trip_id = $1`, [tripId]);
    expect(p.status).toBe('superseded');
  });

  it('AC-03: refuses a hotel that has sold out', async () => {
    const {
      token,
      rates: [rate],
    } = await approvedTrip();
    const decoded = JSON.parse(
      Buffer.from(rate!.rateKey.split('~')[1]!, 'base64url').toString('utf8'),
    ) as { h: string };
    t.suppliers.forEach((s) => s.soldOut.add(`${decoded.h}:${rate!.checkIn}`));
    const res = await confirm(token, 'prepay').expect(409);
    expect(res.body.type).toMatch(/rate-unavailable$/);
  });

  it('refuses a payment mode the hotel does not offer', async () => {
    const { token } = await approvedTrip([
      { from: start, to: mid, pick: (r) => !withDeposit(r) && anyRate(r) },
    ]);
    const res = await confirm(token, 'deposit').expect(422);
    expect(res.body.type).toMatch(/payment-mode-unavailable$/);
  });

  it('pay at hotel: books without taking payment (FR-BKG-03)', async () => {
    const { tripId, token } = await approvedTrip();
    await confirm(token, 'pay_at_hotel').expect(200);
    await t.settle();
    const view = await checkout(token);
    expect(view.status).toBe('confirmed');
    expect(view.payment.state).toBe('none');
    expect(await rows('SELECT id FROM payments.payments')).toHaveLength(0);
    expect((await bookingOf(tripId)).paid.amountMinor).toBe('0');
  });

  it('deposit: collects 20% per hotel now and books (FR-BKG-03)', async () => {
    const {
      tripId,
      token,
      rates: [rate],
    } = await approvedTrip([{ from: start, to: mid, pick: withDeposit }]);
    const total = BigInt(rate!.total.amountMinor);
    const deposit = (total * 20n + 99n) / 100n;
    const view = await checkout(token);
    expect(
      view.paymentOptions.find((o: { mode: string }) => o.mode === 'deposit').dueNow.amountMinor,
    ).toBe(String(deposit));
    await submitAndPay(token, 'deposit');
    const b = await bookingOf(tripId);
    expect(b).toMatchObject({ status: 'confirmed', paid: { amountMinor: String(deposit) } });
  });

  it('a declined card leaves the booking open for another try (FR-PAY-01)', async () => {
    const { token } = await approvedTrip();
    await confirm(token, 'prepay').expect(200);
    await t.settle();
    const first = await checkout(token);
    const declined = await pay(first.payment.clientToken, CARD_DECLINED).expect(200);
    expect(declined.body.status).toBe('declined');
    await t.settle();
    const failed = await checkout(token);
    expect(failed).toMatchObject({
      status: 'draft',
      payment: { state: 'failed', failure: 'card_declined' },
    });

    // Try again with a new request and a good card.
    await confirm(token, 'prepay').expect(200);
    await t.settle();
    const second = await checkout(token);
    expect(second.payment.clientToken).not.toBe(first.payment.clientToken);
    // The first attempt can no longer be paid.
    await pay(first.payment.clientToken).expect(409);
    await pay(second.payment.clientToken).expect(200);
    await t.settle();
    expect((await checkout(token)).status).toBe('confirmed');
    expect(
      (await rows('SELECT status FROM payments.payments ORDER BY created_at')).map((r) => r.status),
    ).toEqual(['failed', 'captured']);
  });

  it('a supplier refusal after payment fails the booking, refunds in full and reopens the trip', async () => {
    const { tripId, token } = await approvedTrip();
    t.suppliers.forEach((s) => (s.rejectReserve = 'sold_out'));
    const view = await submitAndPay(token);
    expect(view.status).toBe('failed');
    expect(view.failureReason).toMatch(/no longer available/);

    const b = await bookingOf(tripId);
    expect(b).toMatchObject({ status: 'failed', paymentState: 'refunded' });
    expect(b.refunded).toEqual(b.paid);
    const [p] = await rows('SELECT status, refunded_minor, amount_minor FROM payments.payments');
    expect(p).toMatchObject({ status: 'refunded' });
    expect(p.refunded_minor).toBe(p.amount_minor);
    expect(await tripStatus(tripId)).toBe('planning');
    expect(mailTo('grace@example.com', /could not complete your booking/)).toHaveLength(1);
    expect(mailTo('ada@example.com', /Booking failed/)).toHaveLength(1);
  });

  it('retries transport errors with the same idempotency key until the hotel confirms (FR-BKG-04, AC-04)', async () => {
    const { tripId, token } = await approvedTrip();
    t.suppliers.forEach((s) => (s.reserveFailures = 2));
    await submitAndPay(token);
    expect((await bookingOf(tripId)).status).toBe('pending');
    await retryDueNow();
    await retryDueNow();
    expect((await bookingOf(tripId)).status).toBe('confirmed');
    const calls = reserveCalls();
    expect(calls).toHaveLength(3);
    expect(new Set(calls.map((c) => c.idempotencyKey)).size).toBe(1);
    // The raw supplier response is kept for support.
    const [l] = await rows('SELECT supplier_response FROM booking.lines');
    expect(l.supplier_response).toMatchObject({ reservationRef: expect.stringMatching(/^RSV-/) });
  });

  it('two hotels: when the second is refused the first is cancelled again and the traveler is refunded', async () => {
    const { tripId, token, rates } = await approvedTrip([
      { from: start, to: mid, pick: anyRate },
      { from: mid, to: end, pick: anyRate },
    ]);
    const second = rates[1]!.total.amountMinor;
    t.suppliers.forEach(
      (s) =>
        (s.rejectWhen = (req) => (req.expectedTotal.amountMinor === second ? 'sold_out' : null)),
    );
    const view = await submitAndPay(token);
    expect(view.status).toBe('failed');
    const b = await bookingOf(tripId);
    expect(b.lines.map((l: { status: string }) => l.status)).toEqual(['cancelled', 'failed']);
    expect(b.paymentState).toBe('refunded');
    expect(b.refunded.amountMinor).toBe(b.paid.amountMinor);
    expect(BigInt(b.paid.amountMinor)).toBe(BigInt(rates[0]!.total.amountMinor) + BigInt(second));
  });

  it('cancel inside the free window: the penalty is quoted first, then everything is refunded (FR-BKG-05)', async () => {
    const { tripId, token } = await approvedTrip();
    await submitAndPay(token);
    const b = await bookingOf(tripId);
    const quote = (await ada.agent.get(`/v1/bookings/${b.id}/cancellation-quote`).expect(200)).body;
    expect(quote).toMatchObject({ estimate: true, penalty: { amountMinor: '0' }, refund: b.paid });

    const res = await ada.agent
      .post(`/v1/bookings/${b.id}/cancel`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ reason: 'Traveler changed plans' })
      .expect(200);
    expect(res.body.cancelling).toBe(true);
    await t.settle();

    const after = await bookingOf(tripId);
    expect(after).toMatchObject({
      status: 'cancelled',
      paymentState: 'refunded',
      cancelling: false,
    });
    expect(after.refunded).toEqual(b.paid);
    expect(await tripStatus(tripId)).toBe('cancelled');
    expect(mailTo('grace@example.com', /booking is cancelled/)).toHaveLength(1);
    // Cancelling twice is harmless, and a cancelled booking cannot be cancelled again.
    await ada.agent
      .post(`/v1/bookings/${b.id}/cancel`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ reason: 'again' })
      .expect(409);
  });

  it('cancelling a non-refundable booking keeps the supplier penalty (FR-BKG-05)', async () => {
    const { tripId, token } = await approvedTrip([{ from: start, to: mid, pick: nonRefundable }]);
    await submitAndPay(token);
    const b = await bookingOf(tripId);
    const quote = (await ada.agent.get(`/v1/bookings/${b.id}/cancellation-quote`).expect(200)).body;
    expect(quote.penalty).toEqual(b.paid);
    expect(quote.refund.amountMinor).toBe('0');

    await ada.agent
      .post(`/v1/bookings/${b.id}/cancel`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ reason: 'Traveler changed plans' })
      .expect(200);
    await t.settle();
    const after = await bookingOf(tripId);
    expect(after).toMatchObject({
      status: 'cancelled',
      penalty: b.paid,
      refunded: { amountMinor: '0' },
    });
    expect(await rows('SELECT id FROM payments.refunds')).toHaveLength(0);
  });

  it('records chargebacks (FR-PAY-02)', async () => {
    const { token } = await approvedTrip();
    const view = await submitAndPay(token);
    expect(view.status).toBe('confirmed');
    const clientToken = (await rows('SELECT client_token FROM payments.payments'))[0].client_token;
    await t
      .http()
      .post(`/v1/dev/fake-payments/${clientToken}/dispute`)
      .send({ reason: 'fraudulent' })
      .expect(202);
    await t.settle();
    expect((await rows('SELECT disputed FROM payments.payments'))[0].disputed).toBe(true);
    expect(await rows('SELECT id FROM payments.disputes')).toHaveLength(1);
    const [pay1] = await rows('SELECT id FROM payments.payments');
    expect(
      await rows(`SELECT id FROM audit.log WHERE action = 'payment.disputed' AND entity_id = $1`, [
        pay1.id,
      ]),
    ).toHaveLength(1);
  });

  it('payment that arrives after the booking failed goes straight back', async () => {
    const { tripId, token } = await approvedTrip();
    await confirm(token, 'prepay').expect(200);
    await t.settle();
    const view = await checkout(token);
    const b = await bookingOf(tripId);
    // The advisor drops the draft while the traveler still has the payment form open.
    await ada.agent.delete(`/v1/bookings/${b.id}`).expect(204);
    await t.settle();
    await pay(view.payment.clientToken).expect(409);
    // A provider-side capture that raced with the discard is refunded, not kept.
    const [p] = await rows('SELECT provider_ref, amount_minor, currency FROM payments.payments');
    const { body, headers } = fakePaymentWebhookRequest({
      type: 'payment.succeeded',
      intentRef: p.provider_ref,
      amountMinor: p.amount_minor,
      currency: p.currency,
    });
    await t
      .http()
      .post('/webhooks/fake-payments')
      .set(headers)
      .set('content-type', 'application/json')
      .send(body)
      .expect(200);
    await t.settle();
    const [after] = await rows(
      'SELECT status, refunded_minor, amount_minor FROM payments.payments',
    );
    expect(after.status).toBe('refunded');
    expect(after.refunded_minor).toBe(after.amount_minor);
  });

  it('an advisor who is not yet active cannot take bookings (FR-AUTH-07)', async () => {
    const bob = await t.onboardAdvisor('bob@example.com'); // approved, Essentials not passed
    const bobClient = await newClient(bob.agent);
    const { token } = await approvedTrip(undefined, bob.agent, bobClient);
    const res = await confirm(token, 'prepay').expect(409);
    expect(res.body.type).toMatch(/booking-not-allowed$/);
  });

  it("one advisor cannot see another's bookings (row-level security)", async () => {
    const { tripId, token } = await approvedTrip();
    await confirm(token, 'pay_at_hotel').expect(200);
    await t.settle();
    const bob = await t.onboardAdvisor('bob@example.com', { essentials: true });
    const b = await bookingOf(tripId);
    await bob.agent.get(`/v1/bookings/${b.id}`).expect(404);
    await bob.agent.get(`/v1/bookings/${b.id}/cancellation-quote`).expect(404);
    expect(await advisorBookings(bob.agent)).toHaveLength(0);
  });

  it('puts bookings stuck pending in the support queue, and support can retry them', async () => {
    const { tripId, token } = await approvedTrip();
    await confirm(token, 'pay_at_hotel').expect(200);
    // The supplier is down: the job fails and waits for its retry.
    t.suppliers.forEach((s) => (s.failing = true));
    await t.settle();
    const b = await bookingOf(tripId);
    expect(b.status).toBe('pending');
    await t.admin.query(`UPDATE booking.bookings SET pending_since = now() - interval '1 hour'`);

    const support = await t.admin1();
    const queue = (await support.get('/v1/support/bookings/stuck').expect(200)).body.items;
    expect(queue.map((q: { id: string }) => q.id)).toEqual([b.id]);
    await ada.agent.get('/v1/support/bookings/stuck').expect(403);

    t.suppliers.forEach((s) => (s.failing = false));
    await support.post(`/v1/support/bookings/${b.id}/retry`).expect(204);
    await t.settle();
    expect((await bookingOf(tripId)).status).toBe('confirmed');
    expect((await support.get('/v1/support/bookings/stuck').expect(200)).body.items).toEqual([]);
  });

  it('gives up after the last retry: the booking fails and the traveler is refunded', async () => {
    const { tripId, token } = await approvedTrip();
    // `failing` also blocks the live re-check, so submit before the outage starts.
    await confirm(token, 'prepay').expect(200);
    await t.settle();
    const view = await checkout(token);
    t.suppliers.forEach((s) => (s.failing = true));
    await pay(view.payment.clientToken).expect(200);
    await t.settle();
    for (let i = 0; i < 8; i++) await retryDueNow();
    const b = await bookingOf(tripId);
    expect(b).toMatchObject({ status: 'failed', paymentState: 'refunded' });
    expect(b.failureReason).toMatch(/could not be reached/);
  });

  it('changing the lead guest: hotels are told and the booking is confirmed again (FR-BKG-05)', async () => {
    const { tripId, token } = await approvedTrip();
    await confirm(token, 'pay_at_hotel').expect(200);
    await t.settle();
    const b = await bookingOf(tripId);
    const patch = (body: object, key = crypto.randomUUID()) =>
      ada.agent.patch(`/v1/bookings/${b.id}/guest`).set('Idempotency-Key', key).send(body);

    await patch({}).expect(400);
    await patch({ name: 'Grace Brewster Hopper', specialRequests: 'High floor' }).expect(200);
    const mid = await bookingOf(tripId);
    expect(mid).toMatchObject({ status: 'modified', modifying: true });
    await t.settle();

    const done = await bookingOf(tripId);
    expect(done).toMatchObject({
      status: 'confirmed',
      modifying: false,
      traveler: { name: 'Grace Brewster Hopper' },
    });
    expect(done.lines[0].guestDetailsSent).toBe(true);
    const calls = t.suppliers.flatMap((s) => s.amendCalls);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.name).toBe('Grace Brewster Hopper');
    expect(mailTo('grace@example.com', /details were updated/)).toHaveLength(1);
    // Nothing to change is refused; a cancelled booking cannot be modified.
    await patch({ name: 'Grace Brewster Hopper', specialRequests: 'High floor' }).expect(422);
    await ada.agent
      .post(`/v1/bookings/${b.id}/cancel`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ reason: 'Traveler cancelled' })
      .expect(200);
    await t.settle();
    await patch({ name: 'Someone Else' }).expect(409);
  });

  it('a hotel that refuses the change is flagged and the advisor is told, but the booking stays confirmed', async () => {
    const { tripId, token } = await approvedTrip();
    await confirm(token, 'pay_at_hotel').expect(200);
    await t.settle();
    const b = await bookingOf(tripId);
    t.suppliers.forEach((s) => (s.rejectAmend = true));
    await ada.agent
      .patch(`/v1/bookings/${b.id}/guest`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ name: 'Grace Murray Hopper' })
      .expect(200);
    await t.settle();
    const after = await bookingOf(tripId);
    expect(after.status).toBe('confirmed');
    expect(after.lines[0]).toMatchObject({ guestDetailsSent: false, guestDetailsRefused: true });
    expect(mailTo('ada@example.com', /did not accept the change/)).toHaveLength(1);
  });

  it('retries a hotel amendment after a transport error with the same key', async () => {
    const { tripId, token } = await approvedTrip();
    await confirm(token, 'pay_at_hotel').expect(200);
    await t.settle();
    const b = await bookingOf(tripId);
    t.suppliers.forEach((s) => (s.amendFailures = 1));
    await ada.agent
      .patch(`/v1/bookings/${b.id}/guest`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ phone: '+44 20 7946 0000' })
      .expect(200);
    await t.settle();
    expect((await bookingOf(tripId)).status).toBe('modified');
    await retryDueNow();
    expect((await bookingOf(tripId)).status).toBe('confirmed');
    const calls = t.suppliers.flatMap((s) => s.amendCalls);
    expect(calls).toHaveLength(2);
    expect(new Set(calls.map((c) => c.idempotencyKey)).size).toBe(1);
  });

  describe('changing a stay on a confirmed booking', () => {
    type Priced = Rate & { total: { amountMinor: string } };
    const totalOf = (r: Rate) => BigInt((r as Priced).total.amountMinor);
    const replace = (
      bookingId: string,
      lineId: string,
      rateKey: string,
      agent: Agent = ada.agent,
    ) =>
      agent
        .post(`/v1/bookings/${bookingId}/lines/${lineId}/replace`)
        .set('Idempotency-Key', crypto.randomUUID())
        .send({ rateKey });
    const shifted = (days: number, d = start) =>
      new Date(Date.parse(d) + days * 86_400_000).toISOString().slice(0, 10);
    const sql = (q: string, p: unknown[] = []) => t.admin.query(q, p).then((r) => r.rows);

    it('pay at hotel: the new stay is reserved first, the old one cancelled, commission follows the new stay', async () => {
      const { tripId, token } = await approvedTrip();
      await confirm(token, 'pay_at_hotel').expect(200);
      await t.settle();
      const b = await bookingOf(tripId);
      const oldLine = b.lines[0];
      const before = await sql(
        `SELECT status, line_id FROM commission.commissions WHERE booking_id = $1`,
        [b.id],
      );
      expect(before).toHaveLength(1);

      // One day later, any refundable pay-at-hotel offer (price may differ: nothing was collected).
      const next = (await rates(ada.agent, shifted(1), shifted(4))).find(refundable)!;
      const res = await replace(b.id, oldLine.id, next.rateKey).expect(201);
      expect(res.body.status).toBe('modified');
      await t.settle();

      const done = await bookingOf(tripId);
      expect(done.status).toBe('confirmed');
      const oldNow = done.lines.find((l: { id: string }) => l.id === oldLine.id);
      const fresh = done.lines.find(
        (l: { replacedBy: string | null; status: string }) =>
          l.replacedBy === null && l.status === 'confirmed',
      );
      expect(oldNow).toMatchObject({ status: 'cancelled' });
      expect(oldNow.replacedBy).toBe(fresh.id);
      expect(fresh.checkIn).toBe(shifted(1));
      // Reserve-first ordering: two reservations, then one cancellation of the original.
      expect(reserveCalls()).toHaveLength(2);
      expect(t.suppliers.flatMap((x) => x.cancelCalls ?? [])).toHaveLength(1);
      expect(BigInt(done.total.amountMinor)).toBe(BigInt(fresh.total.amountMinor));

      const comm = await sql(
        `SELECT line_id, status FROM commission.commissions WHERE booking_id = $1 ORDER BY recognized_at`,
        [b.id],
      );
      expect(comm.find((c) => c.line_id === oldLine.id)?.status).toBe('reversed');
      expect(comm.find((c) => c.line_id === fresh.id)?.status).toBe('expected');
      const variance = await sql(
        `SELECT coalesce(sum(CASE direction WHEN 'debit' THEN amount_minor ELSE -amount_minor END), 0)::text AS v FROM commission.ledger_entries`,
      );
      expect(variance[0].v).toBe('0');
      expect(
        mailTo('grace@example.com', /details were updated|changed|modified/i).length,
      ).toBeGreaterThan(0);

      // Cancelling afterwards reverses the new stay's commission; the old one is not reversed twice.
      await ada.agent
        .post(`/v1/bookings/${b.id}/cancel`)
        .set('Idempotency-Key', crypto.randomUUID())
        .send({ reason: 'Traveler cancelled' })
        .expect(200);
      await t.settle();
      const after = await sql(`SELECT status FROM commission.commissions WHERE booking_id = $1`, [
        b.id,
      ]);
      expect(after.map((c) => c.status)).toEqual(['reversed', 'reversed']);
      expect(
        (
          await sql(`SELECT count(*)::int AS n FROM commission.ledger_txns WHERE kind = 'reversal'`)
        )[0].n,
      ).toBe(2);
      expect(
        (
          await sql(
            `SELECT coalesce(sum(CASE direction WHEN 'debit' THEN amount_minor ELSE -amount_minor END), 0)::text AS v FROM commission.ledger_entries`,
          )
        )[0].v,
      ).toBe('0');
    });

    it('prepaid: a cheaper stay refunds the difference, a dearer one is refused', async () => {
      const { tripId, token } = await approvedTrip([
        { from: start, to: mid, pick: (r) => r.refundable && anyRate(r) },
      ]);
      await submitAndPay(token, 'prepay');
      const b = await bookingOf(tripId);
      const line = b.lines[0];
      const all = (await rates(ada.agent, shifted(1), shifted(4))).filter(
        (r) => r.refundable && anyRate(r),
      );
      const paid = BigInt(b.paid.amountMinor);
      const cheaper = all
        .filter((r) => totalOf(r) < paid)
        .sort((a, c) => Number(totalOf(a) - totalOf(c)))[0]!;
      const dearer = all.find((r) => totalOf(r) > paid)!;
      expect((await replace(b.id, line.id, dearer.rateKey).expect(409)).body.type).toMatch(
        /price-increase$/,
      );
      expect((await bookingOf(tripId)).status).toBe('confirmed'); // nothing started

      await replace(b.id, line.id, cheaper.rateKey).expect(201);
      await t.settle();
      const done = await bookingOf(tripId);
      expect(done.status).toBe('confirmed');
      const expected = paid - totalOf(cheaper);
      expect(BigInt(done.refunded.amountMinor)).toBe(expected);
      const refunds = await sql(
        `SELECT amount_minor::text AS a, reason FROM payments.refunds WHERE booking_id = $1`,
        [b.id],
      );
      expect(refunds).toEqual([{ a: String(expected), reason: 'stay_changed' }]);
    });

    it('is refused when the current hotel would charge to cancel (the traveler must agree)', async () => {
      const { tripId, token } = await approvedTrip([{ from: start, to: mid, pick: nonRefundable }]);
      await submitAndPay(token);
      const b = await bookingOf(tripId);
      const other = (await rates(ada.agent, shifted(1), shifted(4))).find(refundable)!;
      const r = await replace(b.id, b.lines[0].id, other.rateKey).expect(409);
      expect(r.body.type).toMatch(/penalty-applies$/);
      expect((await bookingOf(tripId)).status).toBe('confirmed');
      expect(reserveCalls()).toHaveLength(1); // nothing was reserved
    });

    it('when the new hotel refuses, the old stay stays confirmed and the advisor is told', async () => {
      const { tripId, token } = await approvedTrip();
      await confirm(token, 'pay_at_hotel').expect(200);
      await t.settle();
      const b = await bookingOf(tripId);
      const next = (await rates(ada.agent, shifted(1), shifted(4))).find(refundable)!;
      t.suppliers.forEach((x) => (x.rejectReserve = 'sold_out'));
      await replace(b.id, b.lines[0].id, next.rateKey).expect(201);
      await t.settle();
      const after = await bookingOf(tripId);
      expect(after.status).toBe('confirmed');
      expect(after.lines).toHaveLength(1); // the failed attempt is not shown
      expect(after.lines[0]).toMatchObject({ id: b.lines[0].id, status: 'confirmed' });
      expect(t.suppliers.flatMap((x) => x.cancelCalls ?? [])).toHaveLength(0);
      const comm = await sql(`SELECT status FROM commission.commissions WHERE booking_id = $1`, [
        b.id,
      ]);
      expect(comm.map((c) => c.status)).toEqual(['expected']);
      expect(mailTo('ada@example.com', /did not accept the change/)).toHaveLength(1);
      // It can be tried again once the hotel has room.
      t.suppliers.forEach((x) => (x.rejectReserve = null));
      await replace(b.id, b.lines[0].id, next.rateKey).expect(201);
      await t.settle();
      expect(
        (await bookingOf(tripId)).lines.some((l: { replacedBy: string | null }) => l.replacedBy),
      ).toBe(true);
    });

    it('guards: same stay, different party, other advisors, cancelling bookings', async () => {
      const { tripId, token } = await approvedTrip();
      await confirm(token, 'pay_at_hotel').expect(200);
      await t.settle();
      const b = await bookingOf(tripId);
      const line = b.lines[0];
      const cur = (await rates(ada.agent, start, mid)).find(
        (r) => r.rateKey !== undefined && refundable(r),
      )!;
      void cur;
      const other = (await rates(ada.agent, shifted(1), shifted(4))).find(refundable)!;
      const bob = await t.onboardAdvisor('bob@example.com', { essentials: true });
      await replace(b.id, line.id, other.rateKey, bob.agent).expect(404);
      await replace(b.id, '00000000-0000-7000-8000-000000000000', other.rateKey).expect(404);
      await replace(b.id, line.id, 'x').expect(400);
      // Four adults is not the same party.
      const four = (
        await ada.agent
          .get('/v1/catalog/search')
          .query({ destination: 'lisbon', checkIn: shifted(1), checkOut: shifted(4), adults: 3 })
          .expect(200)
      ).body.results
        .flatMap((r: { rates: Rate[] }) => r.rates)
        .find(refundable);
      if (four) await replace(b.id, line.id, four.rateKey).expect(422);
      await ada.agent
        .post(`/v1/bookings/${b.id}/cancel`)
        .set('Idempotency-Key', crypto.randomUUID())
        .send({ reason: 'Traveler cancelled' })
        .expect(200);
      await replace(b.id, line.id, other.rateKey).expect(409);
    });
  });

  it('streams live booking status to the advisor, and only to that advisor', async () => {
    const live = t.app.get(LiveStatusService);
    const mine: Array<{ type: string; data: { status: string; bookingId: string } }> = [];
    const theirs: unknown[] = [];
    const bob = await t.onboardAdvisor('bob@example.com', { essentials: true });
    const a = live.stream(ada.advisorId).subscribe((m) => mine.push(m as never));
    const b = live.stream(bob.advisorId).subscribe((m) => theirs.push(m));
    await until(() => mine.some((m) => m.type === 'ready') && theirs.some(() => true));

    const { tripId, token } = await approvedTrip();
    await confirm(token, 'pay_at_hotel').expect(200);
    await t.settle();
    await until(() => mine.some((m) => m.type === 'booking' && m.data.status === 'confirmed'));
    const booking = await bookingOf(tripId);
    expect(mine.some((m) => m.data.bookingId === booking.id)).toBe(true);
    expect(theirs.filter((m) => (m as { type: string }).type === 'booking')).toHaveLength(0);
    a.unsubscribe();
    b.unsubscribe();
  });

  it('serves the stream over HTTP to signed-in advisors only', async () => {
    await t.http().get('/v1/bookings/stream').expect(401);
    const res = await new Promise<{ type: string; status: number }>((resolve, reject) => {
      ada.agent
        .get('/v1/bookings/stream')
        .buffer(false)
        .parse((r, cb) => {
          resolve({ type: String(r.headers['content-type']), status: r.statusCode ?? 0 });
          (r as unknown as { destroy(): void }).destroy();
          cb(null, '');
        })
        .end(() => undefined);
      setTimeout(() => reject(new Error('no response')), 5000);
    });
    expect(res.status).toBe(200);
    expect(res.type).toContain('text/event-stream');
  });

  it('completes bookings after check-out (FRD: Confirmed -> Completed)', async () => {
    const { tripId, token } = await approvedTrip();
    await confirm(token, 'pay_at_hotel').expect(200);
    await t.settle();
    await t.admin.query(
      `UPDATE booking.lines SET check_in = current_date - 5, check_out = current_date - 2`,
    );
    await t.runJob('booking.complete-stays');
    await t.settle();
    expect((await bookingOf(tripId)).status).toBe('completed');
    await ada.agent
      .post(`/v1/bookings/${(await bookingOf(tripId)).id}/cancel`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ reason: 'too late' })
      .expect(409);
  });
});
