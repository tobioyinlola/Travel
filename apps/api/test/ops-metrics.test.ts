process.env.METRICS_TOKEN = 'metrics-test-token-123456';

import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MetricsController } from '../src/platform/http/metrics.controller.js';
import { MetricsRegistry } from '../src/platform/metrics.js';
import { inDays, startApp, type TestApp } from './app-harness.js';
import { confirmedBooking } from './flows.js';

type Agent = ReturnType<typeof request.agent>;

describe('operations: SLO metrics for monitoring (ARCH SLOs and alerts)', () => {
  let t: TestApp;
  let ada: { agent: Agent; advisorId: string };
  let clientId: string;
  const auth = { Authorization: 'Bearer metrics-test-token-123456' };

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

  const scrape = async () =>
    (await request(t.app.getHttpServer()).get('/metrics').set(auth).expect(200)).text;
  const value = (text: string, metric: string, labels = '') => {
    const line = text.split('\n').find((l) => l.startsWith(`${metric}${labels} `));
    return line === undefined ? undefined : Number(line.split(' ').at(-1));
  };

  it('is private: a token is required, and with none configured the endpoint does not exist', async () => {
    await request(t.app.getHttpServer()).get('/metrics').expect(401);
    await request(t.app.getHttpServer())
      .get('/metrics')
      .set('Authorization', 'Bearer nope')
      .expect(401);
    const bare = new MetricsController(new MetricsRegistry(), {
      METRICS_TOKEN: undefined,
    } as never);
    await expect(bare.scrape('Bearer anything')).rejects.toMatchObject({ status: 404 });
  });

  it('exposes every SLI named in the architecture, in Prometheus format', async () => {
    const text = await scrape();
    for (const m of [
      'atp_oldest_due_job_age_seconds{queue="critical"}',
      'atp_dead_letters',
      'atp_outbox_unrelayed',
      'atp_webhook_backlog',
      'atp_booking_failure_ratio_10m',
      'atp_bookings_stuck_pending',
      'atp_ledger_variance_minor',
    ])
      expect(
        value(text, m.split('{')[0]!, m.includes('{') ? `{${m.split('{')[1]}` : ''),
        m,
      ).toBeDefined();
    expect(text).toContain('# TYPE http_requests_total counter');
    expect(text).toMatch(/http_request_duration_seconds_bucket\{[^}]*le="\+Inf"\}/);
  });

  it('counts requests by route template, never by raw URL (no tokens in metrics)', async () => {
    await request(t.app.getHttpServer()).get(`/v1/proposal-links/${'a'.repeat(43)}`);
    const text = await scrape();
    expect(text).toContain('route="/v1/proposal-links/:token"');
    expect(text).not.toContain('a'.repeat(43));
  });

  it('shows healthy values after a normal booking, and moves when things go wrong', async () => {
    await confirmedBooking(t, ada.agent, clientId, 60);
    let text = await scrape();
    expect(value(text, 'atp_booking_failure_ratio_10m')).toBe(0);
    expect(value(text, 'atp_ledger_variance_minor')).toBe(0);
    expect(value(text, 'atp_outbox_unrelayed')).toBe(0);
    expect(value(text, 'atp_bookings_stuck_pending')).toBe(0);

    // A booking whose supplier is down stays pending; after 15 minutes it counts as stuck.
    const from = inDays(80);
    const to = inDays(83);
    const trip = (
      await ada.agent
        .post('/v1/trips')
        .send({ clientId, title: 'Stay', startDate: from, endDate: to, adults: 2 })
        .expect(201)
    ).body;
    const rates = (
      await ada.agent
        .get('/v1/catalog/search')
        .query({ destination: 'lisbon', checkIn: from, checkOut: to, adults: 2 })
        .expect(200)
    ).body.results.flatMap(
      (r: { rates: Array<{ rateKey: string; refundable: boolean; paymentModes: string[] }> }) =>
        r.rates,
    );
    const rate = rates.find(
      (r: { refundable: boolean; paymentModes: string[] }) =>
        r.refundable && r.paymentModes.includes('pay_at_hotel'),
    );
    await ada.agent.post(`/v1/trips/${trip.id}/hotels`).send({ rateKey: rate.rateKey }).expect(201);
    const token = (
      (
        await ada.agent
          .post(`/v1/trips/${trip.id}/proposals`)
          .send({ sendEmail: false })
          .expect(201)
      ).body.proposal.url as string
    ).split('/p/')[1]!;
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
    t.suppliers.forEach((s) => (s.failing = true));
    await t.settle();
    await t.admin.query(
      `UPDATE booking.bookings SET pending_since = now() - interval '1 hour' WHERE status = 'pending'`,
    );
    text = await scrape();
    expect(value(text, 'atp_bookings_stuck_pending')).toBe(1);
    expect(
      value(text, 'atp_oldest_due_job_age_seconds', '{queue="critical"}'),
    ).toBeGreaterThanOrEqual(0);
  });

  it('reports a supplier circuit that has opened', async () => {
    t.suppliers.forEach((s) => (s.failing = true));
    for (let i = 0; i < 6; i++)
      await ada.agent
        .get('/v1/catalog/search')
        .query({
          destination: 'paris',
          checkIn: inDays(40 + i),
          checkOut: inDays(43 + i),
          adults: 2,
        })
        .expect(200);
    const text = await scrape();
    expect(value(text, 'atp_supplier_circuit_open', '{supplier="fake-wholesaler-a"}')).toBe(1);
  });

  it('flags a ledger that does not add up (the SLO is exactly zero)', async () => {
    await confirmedBooking(t, ada.agent, clientId, 60);
    // Break the invariant behind the ledger's back (the commission row says it is still owed but the ledger forgot).
    await t.admin.query(
      `UPDATE commission.commissions SET expected_minor = expected_minor + 100, advisor_minor = advisor_minor + 100`,
    );
    const text = await scrape();
    expect(value(text, 'atp_ledger_variance_minor')).toBe(100);
  });

  it('lists jobs that gave up and replays them (the dead-letter runbook)', async () => {
    const adm = await t.admin1();
    await t.admin.query(
      `SELECT graphile_worker.add_job('ai.index-shared', '{}'::json, max_attempts := 1, job_key := 'dead-test')`,
    );
    await t.admin.query(
      `UPDATE graphile_worker._private_jobs SET attempts = max_attempts, last_error = 'boom', run_at = now() - interval '1 hour' WHERE key = 'dead-test'`,
    );
    expect(value(await scrape(), 'atp_dead_letters')).toBe(1);
    const list = (await adm.get('/v1/admin/dead-letters').expect(200)).body.items;
    expect(list[0]).toMatchObject({ task: 'ai.index-shared', lastError: 'boom' });
    await ada.agent.get('/v1/admin/dead-letters').expect(403);
    expect(
      (
        await adm
          .post('/v1/admin/dead-letters/replay')
          .send({ ids: [list[0].id] })
          .expect(200)
      ).body.replayed,
    ).toBe(1);
    expect(value(await scrape(), 'atp_dead_letters')).toBe(0);
  });
});
