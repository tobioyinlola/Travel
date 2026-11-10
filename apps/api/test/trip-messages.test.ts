import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from './app-harness.js';

type Agent = ReturnType<typeof request.agent>;

describe('traveler message thread (FR-TRV-06)', () => {
  let t: TestApp;
  let ada: { agent: Agent; advisorId: string };
  let bob: { agent: Agent; advisorId: string };
  let tripId: string;
  let token: string;

  beforeAll(async () => {
    t = await startApp();
  });
  afterAll(() => t.close());
  beforeEach(async () => {
    await t.reset();
    await t.ingestCatalog();
    ada = await t.onboardAdvisor('ada@example.com', { essentials: true });
    bob = await t.onboardAdvisor('bob@example.com', { essentials: true });
    const clientId = (
      await ada.agent
        .post('/v1/clients')
        .send({ firstName: 'Grace', lastName: 'Hopper', email: 'grace@example.com' })
        .expect(201)
    ).body.id;
    const from = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
    const to = new Date(Date.now() + 63 * 86_400_000).toISOString().slice(0, 10);
    tripId = (
      await ada.agent
        .post('/v1/trips')
        .send({ clientId, title: 'Lisbon', startDate: from, endDate: to, adults: 2 })
        .expect(201)
    ).body.id;
    const rate = (
      await ada.agent
        .get('/v1/catalog/search')
        .query({ destination: 'lisbon', checkIn: from, checkOut: to, adults: 2 })
        .expect(200)
    ).body.results[0].rates[0];
    await ada.agent.post(`/v1/trips/${tripId}/hotels`).send({ rateKey: rate.rateKey }).expect(201);
    token = (
      (await ada.agent.post(`/v1/trips/${tripId}/proposals`).send({ sendEmail: false }).expect(201))
        .body.proposal.url as string
    ).split('/p/')[1]!;
  });

  it('traveler writes, advisor sees it unread and is emailed without the text; reading clears it', async () => {
    const posted = await t
      .http()
      .post(`/v1/proposal-links/${token}/messages`)
      .send({ name: 'Grace Hopper', body: 'Is breakfast included?' })
      .expect(201);
    expect(posted.body.items).toHaveLength(1);
    await t.settle();

    const mail = t.mail.sent.filter(
      (m) => m.to === 'ada@example.com' && /New message/.test(m.subject),
    );
    expect(mail).toHaveLength(1);
    expect(mail[0]!.text).not.toContain('breakfast');

    expect((await ada.agent.get('/v1/trips/messages/unread').expect(200)).body.unread).toBe(1);
    const thread = (await ada.agent.get(`/v1/trips/${tripId}/messages`).expect(200)).body;
    expect(thread).toMatchObject({ unread: 1 });
    expect(thread.items[0]).toMatchObject({ sender: 'traveler', body: 'Is breakfast included?' });

    await ada.agent.post(`/v1/trips/${tripId}/messages/read`).expect(204);
    expect((await ada.agent.get('/v1/trips/messages/unread').expect(200)).body.unread).toBe(0);
  });

  it("the advisor's reply appears for the traveler and emails them a private link", async () => {
    await t
      .http()
      .post(`/v1/proposal-links/${token}/messages`)
      .send({ name: 'Grace Hopper', body: 'Hello?' })
      .expect(201);
    const reply = await ada.agent
      .post(`/v1/trips/${tripId}/messages`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ body: 'Yes, breakfast is included.' })
      .expect(201);
    expect(reply.body.items.map((m: { sender: string }) => m.sender)).toEqual([
      'traveler',
      'advisor',
    ]);
    await t.settle();
    const toTraveler = t.mail.sent.filter(
      (m) => m.to === 'grace@example.com' && /replied/.test(m.subject),
    );
    expect(toTraveler).toHaveLength(1);
    expect(toTraveler[0]!.text).toContain(`/p/${token}`);

    const seen = (await t.http().get(`/v1/proposal-links/${token}/messages`).expect(200)).body;
    expect(seen.items).toHaveLength(2);
  });

  it('is private to the owning advisor and to the link holder, and validates input', async () => {
    await bob.agent.get(`/v1/trips/${tripId}/messages`).expect(404);
    await bob.agent.post(`/v1/trips/${tripId}/messages`).send({ body: 'hi' }).expect(404);
    await t
      .http()
      .get(`/v1/proposal-links/${'x'.repeat(43)}/messages`)
      .expect(404);
    await t
      .http()
      .post(`/v1/proposal-links/${token}/messages`)
      .send({ name: 'G', body: '' })
      .expect(400);
    await ada.agent.post(`/v1/trips/${tripId}/messages`).send({ body: '   ' }).expect(400);
  });

  it('limits how many messages one link can send per hour', async () => {
    const send = () =>
      t.http().post(`/v1/proposal-links/${token}/messages`).send({ name: 'Grace', body: 'again' });
    for (let i = 0; i < 20; i++) await send().expect(201);
    expect((await send().expect(429)).body.type).toMatch(/rate-limited$/);
  });
});
