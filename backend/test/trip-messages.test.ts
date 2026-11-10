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

  it('FR-CRM-08: erasing the client removes the thread, its files and the name in proposals', async () => {
    const up = (
      await t
        .http()
        .post(`/v1/proposal-links/${token}/attachments`)
        .query({ filename: 'passport.pdf' })
        .set('Content-Type', 'application/pdf')
        .send(Buffer.from('%PDF-1.7 secret'))
        .expect(201)
    ).body;
    await t
      .http()
      .post(`/v1/proposal-links/${token}/messages`)
      .send({ name: 'Grace Hopper', body: 'My passport', attachmentIds: [up.id] })
      .expect(201);
    const clientId = (await ada.agent.get(`/v1/trips/${tripId}`).expect(200)).body.clientId;
    const req = (
      await ada.agent
        .post(`/v1/clients/${clientId}/privacy-requests`)
        .send({ kind: 'delete', note: 'Asked by email' })
        .expect(201)
    ).body;
    await (
      await t.admin1()
    )
      .post(`/v1/admin/privacy-requests/${req.id}/verify`)
      .send({ note: 'Verified by phone' })
      .expect(204);
    await t.settle();
    const count = async (table: string) =>
      Number(
        (
          await t.admin.query(`SELECT count(*) AS n FROM itineraries.${table} WHERE trip_id = $1`, [
            tripId,
          ])
        ).rows[0].n,
      );
    expect(await count('messages')).toBe(0);
    expect(await count('attachments')).toBe(0);
    const snap = (
      await t.admin.query(
        `SELECT snapshot->>'clientFirstName' AS n FROM itineraries.proposals WHERE trip_id = $1`,
        [tripId],
      )
    ).rows;
    expect(snap.every((r) => r.n === 'Client')).toBe(true);
  });

  describe('attachments', () => {
    const pdf = (extra = '') => Buffer.from(`%PDF-1.7\n${extra}\n%%EOF`);
    const upload = (filename: string, bytes: Buffer, type = 'application/pdf') =>
      t
        .http()
        .post(`/v1/proposal-links/${token}/attachments`)
        .query({ filename })
        .set('Content-Type', type)
        .send(bytes);

    it('a traveler attaches a file to a message; the advisor downloads exactly those bytes, as a download', async () => {
      const bytes = pdf('passport details');
      const up = (await upload('../../passport scan.pdf', bytes).expect(201)).body;
      expect(up).toMatchObject({ filename: 'passport scan.pdf', contentType: 'application/pdf' });
      // Not downloadable until it is part of a sent message.
      await t.http().get(`/v1/proposal-links/${token}/attachments/${up.id}`).expect(404);
      const sent = await t
        .http()
        .post(`/v1/proposal-links/${token}/messages`)
        .send({ name: 'Grace Hopper', body: 'My passport', attachmentIds: [up.id] })
        .expect(201);
      expect(sent.body.items[0].attachments).toEqual([
        {
          id: up.id,
          filename: 'passport scan.pdf',
          contentType: 'application/pdf',
          sizeBytes: bytes.length,
        },
      ]);
      const dl = await ada.agent
        .get(`/v1/trips/${tripId}/attachments/${up.id}`)
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(Buffer.compare(dl.body as Buffer, bytes)).toBe(0);
      expect(dl.headers['content-disposition']).toMatch(/^attachment;/);
      expect(dl.headers['content-type']).toMatch(/application\/pdf/);
      // The same file is visible to the traveler through their link, and to nobody else.
      await t.http().get(`/v1/proposal-links/${token}/attachments/${up.id}`).expect(200);
      await bob.agent.get(`/v1/trips/${tripId}/attachments/${up.id}`).expect(404);
    });

    it('the advisor can attach a file to a reply', async () => {
      const up = (
        await ada.agent
          .post(`/v1/trips/${tripId}/attachments`)
          .query({ filename: 'itinerary.pdf' })
          .set('Content-Type', 'application/pdf')
          .send(pdf())
          .expect(201)
      ).body;
      const r = await ada.agent
        .post(`/v1/trips/${tripId}/messages`)
        .send({ body: 'Here is the detail', attachmentIds: [up.id] })
        .expect(201);
      expect(r.body.items[0].attachments[0].filename).toBe('itinerary.pdf');
      const seen = (await t.http().get(`/v1/proposal-links/${token}/messages`).expect(200)).body;
      expect(seen.items[0].attachments).toHaveLength(1);
    });

    it('refuses disguised, infected, empty and oversized files, and files that are not yours', async () => {
      const html = Buffer.from('<html><script>alert(1)</script></html>');
      expect((await upload('x.pdf', html).expect(415)).body.type).toMatch(/file-type-not-allowed$/);
      const bad = pdf('X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*');
      expect((await upload('virus.pdf', bad).expect(422)).body.type).toMatch(/file-rejected$/);
      await upload('empty.pdf', Buffer.alloc(0)).expect(413);
      await upload('big.pdf', Buffer.concat([pdf(), Buffer.alloc(5_300_000)])).expect(413);
      await upload('x.txt', Buffer.from('hi'), 'text/plain').expect(415);

      // A file uploaded by the advisor cannot be claimed by the traveler's message, nor reused twice.
      const mine = (
        await ada.agent
          .post(`/v1/trips/${tripId}/attachments`)
          .query({ filename: 'a.pdf' })
          .set('Content-Type', 'application/pdf')
          .send(pdf())
          .expect(201)
      ).body;
      await t
        .http()
        .post(`/v1/proposal-links/${token}/messages`)
        .send({ name: 'Grace Hopper', body: 'hi', attachmentIds: [mine.id] })
        .expect(400);
      await ada.agent
        .post(`/v1/trips/${tripId}/messages`)
        .send({ body: 'ok', attachmentIds: [mine.id] })
        .expect(201);
      await ada.agent
        .post(`/v1/trips/${tripId}/messages`)
        .send({ body: 'again', attachmentIds: [mine.id] })
        .expect(400);
      await bob.agent
        .post(`/v1/trips/${tripId}/attachments`)
        .query({ filename: 'a.pdf' })
        .set('Content-Type', 'application/pdf')
        .send(pdf())
        .expect(404);
    });
  });
});
