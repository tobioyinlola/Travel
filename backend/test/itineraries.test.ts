import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { inDays, startApp, type TestApp } from './app-harness.js';

type Agent = ReturnType<typeof request.agent>;

describe('itineraries and proposals (FR-ITN-01..06, FR-TRV-01..03, AC-02)', () => {
  let t: TestApp;
  let ada: { agent: Agent; advisorId: string };
  let clientId: string;
  const start = inDays(60);
  const end = inDays(67);

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
  });

  afterAll(() => t.close());

  async function newTrip(agent: Agent = ada.agent, extra: Record<string, unknown> = {}) {
    return (
      await agent
        .post('/v1/trips')
        .send({
          clientId,
          title: 'Lisbon family week',
          startDate: start,
          endDate: end,
          adults: 2,
          childrenAges: [7],
          ...extra,
        })
        .expect(201)
    ).body;
  }

  async function searchLisbon(agent: Agent = ada.agent) {
    const res = (
      await agent
        .get('/v1/catalog/search')
        .query({
          destination: 'lisbon',
          checkIn: start,
          checkOut: inDays(63),
          adults: 2,
          childrenAges: '7',
        })
        .expect(200)
    ).body;
    return res.results[0].rates[0];
  }

  async function builtTrip() {
    const trip = await newTrip(ada.agent, { planningFeeMinor: '15000' });
    const rate = await searchLisbon();
    await ada.agent.post(`/v1/trips/${trip.id}/hotels`).send({ rateKey: rate.rateKey }).expect(201);
    await ada.agent
      .post(`/v1/trips/${trip.id}/items`)
      .send({
        kind: 'activity',
        day: inDays(61),
        title: 'Alfama food tour',
        startTime: '10:00',
        priceMinor: '9000',
      })
      .expect(201);
    const full = (
      await ada.agent
        .post(`/v1/trips/${trip.id}/items`)
        .send({ kind: 'note', day: start, title: 'Bring sun hats' })
        .expect(201)
    ).body;
    return { trip: full, rate };
  }

  async function publish(tripId: string, sendEmail = true) {
    const res = (
      await ada.agent.post(`/v1/trips/${tripId}/proposals`).send({ sendEmail }).expect(201)
    ).body;
    await t.settle();
    return res as {
      proposal: { url: string; version: number; id: string; total: { amountMinor: string } };
      priceChanges: unknown[];
    };
  }

  const tokenOf = (url: string) => url.split('/p/')[1]!;

  it('builds a day-by-day itinerary with a hotel, an activity, a note and a planning fee (FR-ITN-01..03)', async () => {
    const { trip, rate } = await builtTrip();
    expect(trip.items.map((i: { kind: string }) => i.kind)).toEqual(['hotel', 'note', 'activity']);
    const hotel = trip.items[0];
    expect(hotel.hotel.rate).toMatchObject({
      checkIn: start,
      roomName: rate.roomName,
      total: rate.total,
    });
    const expected = BigInt(rate.total.amountMinor) + 9000n + 15000n;
    expect(trip.totals.total).toEqual({ amountMinor: String(expected), currency: 'USD' });
    expect(trip.totals.payableAtProperty).toEqual(rate.feesAtHotel);
    expect(trip.totals.planningFee.amountMinor).toBe('15000');
  });

  it('refuses hotels that do not fit the trip, and days outside it', async () => {
    const trip = await newTrip();
    const wrongParty = (
      await ada.agent
        .get('/v1/catalog/search')
        .query({ destination: 'lisbon', checkIn: start, checkOut: inDays(62), adults: 2 })
        .expect(200)
    ).body.results[0].rates[0];
    expect(
      (
        await ada.agent
          .post(`/v1/trips/${trip.id}/hotels`)
          .send({ rateKey: wrongParty.rateKey })
          .expect(400)
      ).body.type,
    ).toMatch(/party-mismatch/);
    const tooLate = (
      await ada.agent
        .get('/v1/catalog/search')
        .query({
          destination: 'lisbon',
          checkIn: inDays(66),
          checkOut: inDays(70),
          adults: 2,
          childrenAges: '7',
        })
        .expect(200)
    ).body.results[0].rates[0];
    expect(
      (
        await ada.agent
          .post(`/v1/trips/${trip.id}/hotels`)
          .send({ rateKey: tooLate.rateKey })
          .expect(400)
      ).body.type,
    ).toMatch(/stay-outside-trip/);
    await ada.agent
      .post(`/v1/trips/${trip.id}/items`)
      .send({ kind: 'activity', day: inDays(90), title: 'x' })
      .expect(400);
  });

  it("only plans trips for the advisor's own clients, and hides trips from other advisors", async () => {
    const bo = await t.onboardAdvisor('bo@example.com');
    await bo.agent
      .post('/v1/trips')
      .send({ clientId, title: 'Stolen', startDate: start, endDate: end, adults: 1 })
      .expect(404);
    const trip = await newTrip();
    await bo.agent.get(`/v1/trips/${trip.id}`).expect(404);
    expect((await bo.agent.get('/v1/trips').expect(200)).body).toEqual([]);
  });

  it("records the trip in the client's history (FR-CRM-03)", async () => {
    const trip = await newTrip();
    await t.settle();
    const client = (await ada.agent.get(`/v1/clients/${clientId}`).expect(200)).body;
    expect(client.trips).toEqual([
      expect.objectContaining({
        tripId: trip.id,
        title: 'Lisbon family week',
        status: 'planning',
        startDate: start,
      }),
    ]);
  });

  it('publishes a proposal, emails the secret link, and never stores the link in the message log (FR-ITN-04)', async () => {
    const { trip } = await builtTrip();
    const { proposal } = await publish(trip.id);
    expect(proposal.version).toBe(1);
    expect(proposal.url).toMatch(/\/p\/[A-Za-z0-9_-]{43}$/);
    const mail = t.mail.sent.find((m) => m.to === 'grace@example.com');
    expect(mail?.subject).toBe('Ada sent you a trip proposal');
    expect(mail?.text).toContain(proposal.url);
    const { rows } = await t.admin.query(
      `SELECT body_text FROM notifications.messages WHERE template = 'proposal_sent'`,
    );
    expect(rows).toEqual([{ body_text: '[redacted]' }]);
    expect((await ada.agent.get(`/v1/trips/${trip.id}`).expect(200)).body.status).toBe('proposed');
  });

  it('shows the traveler the proposal without commission, supplier or rate details (FR-TRV-01/02)', async () => {
    const { trip } = await builtTrip();
    const { proposal } = await publish(trip.id, false);
    const view = (
      await t
        .http()
        .get(`/v1/proposal-links/${tokenOf(proposal.url)}`)
        .expect(200)
    ).body;
    expect(view).toMatchObject({
      title: 'Lisbon family week',
      clientFirstName: 'Grace',
      advisorName: 'Ada',
      status: 'published',
      ratesExpired: false,
    });
    expect(view.items[0].hotel).toMatchObject({
      checkIn: start,
      refundable: expect.any(Boolean),
      cancellationPolicy: expect.any(String),
    });
    expect(JSON.stringify(view)).not.toMatch(/commission|rateKey|supplier|rateCodes|wholesaler/i);
    await t
      .http()
      .get('/v1/proposal-links/not-a-real-token-but-long-enough-to-pass-the-format-check')
      .expect(404);
    const { rows } = await t.admin.query('SELECT first_viewed_at FROM itineraries.proposals');
    expect(rows[0].first_viewed_at).not.toBeNull();
  });

  it('AC-02: approval is timestamped, the version is locked, the advisor is notified', async () => {
    const { trip } = await builtTrip();
    const { proposal } = await publish(trip.id, false);
    const token = tokenOf(proposal.url);
    await t
      .http()
      .post(`/v1/proposal-links/${token}/decision`)
      .send({ decision: 'request_changes', name: 'Grace Hopper' })
      .expect(400);

    const approved = (
      await t
        .http()
        .post(`/v1/proposal-links/${token}/decision`)
        .send({ decision: 'approve', name: 'Grace Hopper' })
        .expect(200)
    ).body;
    expect(approved).toMatchObject({ status: 'approved', decidedByName: 'Grace Hopper' });
    expect(Date.now() - Date.parse(approved.decidedAt)).toBeLessThan(10_000);
    await t
      .http()
      .post(`/v1/proposal-links/${token}/decision`)
      .send({ decision: 'decline', name: 'Grace Hopper', note: 'oops' })
      .expect(409);

    const after = (await ada.agent.get(`/v1/trips/${trip.id}`).expect(200)).body;
    expect(after.status).toBe('approved');
    await ada.agent
      .post(`/v1/trips/${trip.id}/items`)
      .send({ kind: 'note', day: start, title: 'late edit' })
      .expect(409);
    await ada.agent.post(`/v1/trips/${trip.id}/proposals`).send({}).expect(409);

    await t.settle();
    const notice = t.mail.sent.find(
      (m) => m.to === 'ada@example.com' && m.subject.startsWith('Proposal approved'),
    );
    expect(notice?.subject).toBe('Proposal approved: Lisbon family week');
    expect(notice?.text).toContain('Grace Hopper approved your proposal');
    const event = await t.admin.query(
      `SELECT payload FROM platform.outbox WHERE type = 'ProposalApproved'`,
    );
    expect(event.rows[0].payload).toMatchObject({
      proposalVersion: 1,
      tripId: trip.id,
      advisorId: ada.advisorId,
    });
  });

  it('asks for changes; the advisor republishes a new version on the same link', async () => {
    const { trip } = await builtTrip();
    const v1 = (await publish(trip.id, false)).proposal;
    const token = tokenOf(v1.url);
    await t
      .http()
      .post(`/v1/proposal-links/${token}/decision`)
      .send({
        decision: 'request_changes',
        name: 'Grace',
        note: 'Could we add a day trip to Sintra?',
      })
      .expect(200);
    await t.settle();
    expect(
      t.mail.sent.find((m) => m.subject === 'Changes requested: Lisbon family week')?.text,
    ).toContain('Sintra');
    expect((await ada.agent.get(`/v1/trips/${trip.id}`).expect(200)).body.status).toBe('planning');

    await ada.agent
      .post(`/v1/trips/${trip.id}/items`)
      .send({ kind: 'activity', day: inDays(62), title: 'Sintra day trip', priceMinor: '12000' })
      .expect(201);
    const v2 = (await publish(trip.id, false)).proposal;
    expect(v2.version).toBe(2);
    expect(v2.url).toBe(v1.url);
    const view = (await t.http().get(`/v1/proposal-links/${token}`).expect(200)).body;
    expect(view).toMatchObject({ version: 2, status: 'published' });
    expect(view.items.map((i: { title: string }) => i.title)).toContain('Sintra day trip');
    const all = (await ada.agent.get(`/v1/trips/${trip.id}`).expect(200)).body.proposals;
    expect(all.map((p: { version: number; status: string }) => [p.version, p.status])).toEqual([
      [2, 'published'],
      [1, 'superseded'],
    ]);
  });

  it('expires prices: the traveler cannot approve until the advisor re-checks them (FR-ITN-05)', async () => {
    const { trip } = await builtTrip();
    const { proposal } = await publish(trip.id, false);
    const token = tokenOf(proposal.url);
    await t.admin.query(
      `UPDATE itineraries.proposals SET rates_expire_at = now() - interval '1 minute'`,
    );
    expect((await t.http().get(`/v1/proposal-links/${token}`).expect(200)).body.ratesExpired).toBe(
      true,
    );
    const refused = await t
      .http()
      .post(`/v1/proposal-links/${token}/decision`)
      .send({ decision: 'approve', name: 'Grace' })
      .expect(409);
    expect(refused.body.type).toMatch(/prices-expired/);

    // Prices unchanged: same version, valid again.
    const same = (await ada.agent.post(`/v1/trips/${trip.id}/proposals/refresh`).expect(200)).body;
    expect(same).toMatchObject({ republished: false, priceChanges: [], proposal: { version: 1 } });
    expect((await t.http().get(`/v1/proposal-links/${token}`).expect(200)).body.ratesExpired).toBe(
      false,
    );

    // Prices moved: new version on the same link with the new total.
    for (const s of t.suppliers) s.priceEpoch = 1;
    const moved = (await ada.agent.post(`/v1/trips/${trip.id}/proposals/refresh`).expect(200)).body;
    expect(moved.republished).toBe(true);
    expect(moved.priceChanges).toHaveLength(1);
    expect(BigInt(moved.proposal.total.amountMinor)).toBeGreaterThan(
      BigInt(proposal.total.amountMinor),
    );
    expect((await t.http().get(`/v1/proposal-links/${token}`).expect(200)).body.version).toBe(2);
    await t
      .http()
      .post(`/v1/proposal-links/${token}/decision`)
      .send({ decision: 'approve', name: 'Grace' })
      .expect(200);
  });

  it('will not publish a hotel that has sold out', async () => {
    const { trip } = await builtTrip();
    const supplierPropertyId = Buffer.from(
      trip.items[0].hotel.rate.rateKey.split('~')[1],
      'base64url',
    )
      .toString('utf8')
      .match(/"h":"([^"]+)"/)![1];
    const supplier = t.suppliers.find((s) => trip.items[0].hotel.rate.rateKey.startsWith(s.name))!;
    supplier.soldOut.add(`${supplierPropertyId}:${start}`);
    const res = await ada.agent.post(`/v1/trips/${trip.id}/proposals`).send({}).expect(409);
    expect(res.body.type).toMatch(/rates-unavailable/);
  });

  it('expired links answer 410 Gone', async () => {
    const { trip } = await builtTrip();
    const { proposal } = await publish(trip.id, false);
    await t.admin.query(
      `UPDATE itineraries.proposals SET token_expires_at = now() - interval '1 second'`,
    );
    await t
      .http()
      .get(`/v1/proposal-links/${tokenOf(proposal.url)}`)
      .expect(410);
  });
});

describe('trip list rows and the advisor dashboard summary', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startApp();
    await t.reset();
    await t.ingestCatalog();
  });
  afterAll(() => t.close());

  it('lists trips with client, destination, nights and total, and summarises them', async () => {
    const ada = await t.onboardAdvisor('sum@example.com', { essentials: true });
    const clientId = (
      await ada.agent
        .post('/v1/clients')
        .send({ firstName: 'Grace', lastName: 'Hopper' })
        .expect(201)
    ).body.id;
    const trip = (
      await ada.agent
        .post('/v1/trips')
        .send({ clientId, title: 'Lisbon', startDate: inDays(60), endDate: inDays(64), adults: 2 })
        .expect(201)
    ).body;
    const rate = (
      await ada.agent
        .get('/v1/catalog/search')
        .query({ destination: 'lisbon', checkIn: inDays(60), checkOut: inDays(63), adults: 2 })
        .expect(200)
    ).body.results[0].rates[0];
    await ada.agent.post(`/v1/trips/${trip.id}/hotels`).send({ rateKey: rate.rateKey }).expect(201);
    await ada.agent.post(`/v1/trips/${trip.id}/proposals`).send({}).expect(201);

    const [row] = (await ada.agent.get('/v1/trips').expect(200)).body;
    expect(row).toMatchObject({
      clientName: 'Grace Hopper',
      nights: 4,
      travelers: 2,
      status: 'proposed',
      destination: { city: 'Lisbon', countryCode: 'PT' },
      total: rate.total,
    });

    const s = (await ada.agent.get('/v1/trips/summary').expect(200)).body;
    expect(s.counts).toMatchObject({ total: 1, proposed: 1, upcoming: 1 });
    expect(s.clients).toBe(1);
    expect(s.pipelineValue).toEqual(rate.total);
    expect(s.destinations).toEqual([{ countryCode: 'PT', city: 'Lisbon', trips: 1, travelers: 2 }]);
    expect(s.proposalsLast7Days).toHaveLength(7);
    expect(s.proposalsLast7Days[6].proposals).toBe(1);
  });
});
