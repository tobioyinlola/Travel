import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from './app-harness.js';

const ada = {
  firstName: 'Grace',
  lastName: 'Hopper',
  email: 'grace@example.com',
  phone: '+2348011111111',
  dateOfBirth: '1980-12-09',
  homeCity: 'Lagos',
  preferences: {
    budgetPerNight: {
      min: { amountMinor: '15000', currency: 'USD' },
      max: { amountMinor: '40000', currency: 'USD' },
    },
    hotelStyles: ['boutique', 'family'],
    dietary: ['vegetarian'],
    loyalty: [{ program: 'Marriott Bonvoy', number: 'MB123456' }],
    accessibility: 'Ground-floor room',
  },
};

describe('clients CRM (FR-CRM-01/02/03/07/08, AC-10)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startApp();
  });
  beforeEach(() => t.reset());
  afterAll(() => t.close());

  it('creates a client with preferences and companions, lists and searches', async () => {
    const a = await t.onboardAdvisor('ada@example.com');
    const c = (await a.agent.post('/v1/clients').send(ada).expect(201)).body;
    expect(c).toMatchObject({
      firstName: 'Grace',
      dateOfBirth: '1980-12-09',
      status: 'active',
      version: 1,
      companions: [],
      trips: [],
    });
    expect(c.preferences.hotelStyles).toEqual(['boutique', 'family']);

    const withKid = (
      await a.agent
        .post(`/v1/clients/${c.id}/companions`)
        .send({
          firstName: 'Ola',
          lastName: 'Hopper',
          relationship: 'child',
          dateOfBirth: '2018-03-01',
        })
        .expect(201)
    ).body;
    expect(withKid.companions).toHaveLength(1);
    expect(withKid.version).toBe(2);

    await a.agent.post('/v1/clients').send({ firstName: 'Alan', lastName: 'Turing' }).expect(201);
    const all = (await a.agent.get('/v1/clients').expect(200)).body;
    expect(all.items.map((x: { lastName: string }) => x.lastName)).toEqual(['Hopper', 'Turing']);
    const found = (await a.agent.get('/v1/clients').query({ q: 'grace@' }).expect(200)).body;
    expect(found.items).toHaveLength(1);
  });

  it('validates input: budget ordering, unknown preference keys, phone format', async () => {
    const a = await t.onboardAdvisor('ada@example.com');
    const bad = {
      ...ada,
      preferences: {
        budgetPerNight: {
          min: { amountMinor: '50000', currency: 'USD' },
          max: { amountMinor: '100', currency: 'USD' },
        },
      },
    };
    await a.agent.post('/v1/clients').send(bad).expect(400);
    await a.agent
      .post('/v1/clients')
      .send({ ...ada, preferences: { favouriteColour: 'blue' } })
      .expect(400);
    await a.agent
      .post('/v1/clients')
      .send({ ...ada, phone: '0801 111 1111' })
      .expect(400);
  });

  it('refuses a stale update (optimistic locking) and applies a current one', async () => {
    const a = await t.onboardAdvisor('ada@example.com');
    const c = (await a.agent.post('/v1/clients').send(ada).expect(201)).body;
    const updated = (
      await a.agent.patch(`/v1/clients/${c.id}`).send({ version: 1, homeCity: 'Abuja' }).expect(200)
    ).body;
    expect(updated).toMatchObject({ homeCity: 'Abuja', version: 2 });
    const stale = await a.agent
      .patch(`/v1/clients/${c.id}`)
      .send({ version: 1, homeCity: 'Kano' })
      .expect(409);
    expect(stale.body.type).toMatch(/version-conflict/);
  });

  it("AC-10: one advisor cannot see or change another advisor's clients", async () => {
    const a = await t.onboardAdvisor('ada@example.com');
    const b = await t.onboardAdvisor('bo@example.com');
    const c = (await a.agent.post('/v1/clients').send(ada).expect(201)).body;

    expect((await b.agent.get('/v1/clients').expect(200)).body.items).toEqual([]);
    await b.agent.get(`/v1/clients/${c.id}`).expect(404);
    await b.agent.patch(`/v1/clients/${c.id}`).send({ version: 1, notes: 'mine now' }).expect(404);
    await b.agent
      .post(`/v1/clients/${c.id}/companions`)
      .send({ firstName: 'X', lastName: 'Y', relationship: 'friend' })
      .expect(404);
    await b.agent.post(`/v1/clients/${c.id}/privacy-requests`).send({ kind: 'delete' }).expect(404);
    expect((await a.agent.get(`/v1/clients/${c.id}`).expect(200)).body.notes).toBe('');
  });

  it('row-level security hides rows even from a query that forgets the owner filter', async () => {
    const a = await t.onboardAdvisor('ada@example.com');
    const b = await t.onboardAdvisor('bo@example.com');
    await a.agent.post('/v1/clients').send(ada).expect(201);
    const count = (advisorId: string | null) =>
      t.db.transaction('clients', async (tx) => {
        if (advisorId) await tx.setLocal('atp.advisor_id', advisorId);
        const [r] = await tx.query<{ n: number }>('SELECT count(*)::int AS n FROM clients.clients');
        return r!.n;
      });
    expect(await count(a.advisorId)).toBe(1);
    expect(await count(b.advisorId)).toBe(0);
    expect(await count(null)).toBe(0);
    await expect(
      t.db.transaction('clients', async (tx) => {
        await tx.setLocal('atp.advisor_id', b.advisorId);
        await tx.query(
          `INSERT INTO clients.clients (id, owner_advisor_id, first_name, last_name) VALUES (gen_random_uuid(), $1, 'x', 'y')`,
          [a.advisorId],
        );
      }),
    ).rejects.toThrow(/row-level security/);
  });

  it('archives and restores', async () => {
    const a = await t.onboardAdvisor('ada@example.com');
    const c = (await a.agent.post('/v1/clients').send(ada).expect(201)).body;
    await a.agent.post(`/v1/clients/${c.id}/archive`).expect(200);
    expect((await a.agent.get('/v1/clients').expect(200)).body.items).toEqual([]);
    expect((await a.agent.get('/v1/clients?status=archived').expect(200)).body.items).toHaveLength(
      1,
    );
    await a.agent.post(`/v1/clients/${c.id}/restore`).expect(200);
    expect((await a.agent.get('/v1/clients').expect(200)).body.items).toHaveLength(1);
  });

  it('is for members: applicants cannot use the CRM', async () => {
    const applicant = await t.signUpAdvisor('new@example.com');
    await applicant.agent.get('/v1/clients').expect(403);
  });

  it('FR-CRM-08: export request is verified by support, then produced and downloadable', async () => {
    const a = await t.onboardAdvisor('ada@example.com');
    const c = (await a.agent.post('/v1/clients').send(ada).expect(201)).body;
    const req = (
      await a.agent
        .post(`/v1/clients/${c.id}/privacy-requests`)
        .send({ kind: 'export', note: 'Client emailed on 9 Nov' })
        .expect(201)
    ).body;
    await a.agent.post(`/v1/clients/${c.id}/privacy-requests`).send({ kind: 'export' }).expect(409);

    const admin = await t.admin1();
    const pending = (await admin.get('/v1/admin/privacy-requests?status=requested').expect(200))
      .body;
    expect(pending).toEqual([
      expect.objectContaining({ id: req.id, kind: 'export', clientName: 'Grace Hopper' }),
    ]);
    expect(new Date(pending[0].dueAt).getTime() - Date.now()).toBeGreaterThan(29 * 86400_000);
    await admin.get(`/v1/admin/privacy-requests/${req.id}/export`).expect(404);

    await admin
      .post(`/v1/admin/privacy-requests/${req.id}/verify`)
      .send({ note: 'Called the client back on file number' })
      .expect(204);
    await t.settle();
    const exp = (await admin.get(`/v1/admin/privacy-requests/${req.id}/export`).expect(200)).body;
    expect(exp.client).toMatchObject({
      first_name: 'Grace',
      email: 'grace@example.com',
      date_of_birth: '1980-12-09',
    });
    const view = (await a.agent.get(`/v1/clients/${c.id}`).expect(200)).body;
    expect(view.privacyRequests[0]).toMatchObject({ kind: 'export', status: 'completed' });
    await a.agent.get('/v1/admin/privacy-requests').expect(403);
  });

  it('FR-CRM-08: verified deletion erases personal data, keeps no PII in the audit trail, and tells other modules', async () => {
    const a = await t.onboardAdvisor('ada@example.com');
    const c = (await a.agent.post('/v1/clients').send(ada).expect(201)).body;
    await a.agent
      .post(`/v1/clients/${c.id}/companions`)
      .send({ firstName: 'Ola', lastName: 'Hopper', relationship: 'child' })
      .expect(201);
    const req = (
      await a.agent
        .post(`/v1/clients/${c.id}/privacy-requests`)
        .send({ kind: 'delete' })
        .expect(201)
    ).body;
    const admin = await t.admin1();
    await admin
      .post(`/v1/admin/privacy-requests/${req.id}/verify`)
      .send({ note: 'Identity confirmed' })
      .expect(204);
    await t.settle();

    await a.agent.get(`/v1/clients/${c.id}`).expect(404);
    const { rows } = await t.admin.query(
      'SELECT first_name, email, phone, preferences, status FROM clients.clients WHERE id = $1',
      [c.id],
    );
    expect(rows[0]).toEqual({
      first_name: 'Erased',
      email: null,
      phone: null,
      preferences: {},
      status: 'erased',
    });
    expect(
      (
        await t.admin.query(
          'SELECT count(*)::int AS n FROM clients.companions WHERE client_id = $1',
          [c.id],
        )
      ).rows[0].n,
    ).toBe(0);
    const outbox = await t.admin.query(
      `SELECT payload FROM platform.outbox WHERE type = 'ClientDataErased'`,
    );
    expect(outbox.rows[0].payload).toMatchObject({ clientId: c.id, advisorId: a.advisorId });
    const audit = await t.admin.query(
      `SELECT before, after, metadata FROM audit.log WHERE entity_id = $1`,
      [c.id],
    );
    expect(JSON.stringify(audit.rows)).not.toMatch(/Grace|Hopper|grace@example\.com|MB123456/);
  });
});
