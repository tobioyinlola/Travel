import type { INestApplication } from '@nestjs/common';
import { runOnce } from 'graphile-worker';
import type { Redis } from 'ioredis';
import { Pool } from 'pg';
import request from 'supertest';
import { loadConfig } from '../src/config.js';
import { createHttpApp } from '../src/http-app.js';
import { MESSAGING_PORT, MemoryMessaging } from '../src/modules/notifications/index.js';
import { totp } from '../src/modules/identity/domain/totp.js';
import { AuthService, IdentityApi } from '../src/modules/identity/index.js';
import { CatalogApi, FakeHotelSupplier, HOTEL_SUPPLIERS } from '../src/modules/catalog/index.js';
import { SearchService } from '../src/modules/catalog/application/search.service.js';
import { FakePaymentProvider, PAYMENT_PROVIDER } from '../src/modules/commission-payments/index.js';
import { Database } from '../src/platform/db/database.js';
import { EventBus } from '../src/platform/events/event-bus.js';
import { OutboxRelay } from '../src/platform/events/outbox-relay.js';
import { JobRegistry } from '../src/platform/jobs/job-registry.js';
import { buildTaskList } from '../src/platform/jobs/worker-runner.js';
import { REDIS } from '../src/platform/tokens.js';

/** Reference data loaded by migrations; never truncated between tests. */
const SEED_TABLES = [
  'plans',
  'courses',
  'lessons',
  'quiz_questions',
  'forum_categories',
  'destinations',
  'properties',
  'property_sources',
  'ingestion_runs',
];

/**
 * The real HTTP app (all modules, fake providers, in-memory email) plus a way to run the worker's work
 * synchronously: relay the outbox and run due jobs until nothing is left.
 */
export async function startApp() {
  const config = loadConfig();
  const app: INestApplication = await createHttpApp(config, { logger: false });
  await app.init();
  const db = app.get(Database);
  const jobs = app.get(JobRegistry);
  const relay = new OutboxRelay(db, app.get(EventBus));
  const mail = app.get(MESSAGING_PORT) as MemoryMessaging;
  const redis = app.get<Redis>(REDIS);
  const admin = new Pool({ connectionString: config.DATABASE_ADMIN_URL, max: 2 });
  const http = () => request(app.getHttpServer());
  const suppliers = app.get<FakeHotelSupplier[]>(HOTEL_SUPPLIERS);

  /** Loads both fake suppliers' content into the catalog (idempotent; catalog tables survive reset). */
  async function ingestCatalog(): Promise<void> {
    await app.get(CatalogApi).ingestAll();
    await settle();
  }
  /** Runs one registered job (e.g. a cron task) now, as the worker would. */
  async function runJob(name: string, payload: unknown = {}): Promise<void> {
    const job = jobs.get(name);
    if (!job) throw new Error(`No such job: ${name}`);
    await job.handle(payload, { jobId: 'test', attempts: 1, maxAttempts: 1, correlationId: null });
  }
  const server = () => app.getHttpServer();
  const app_ = app;

  async function settle(): Promise<void> {
    for (let i = 0; i < 20; i++) {
      const relayed = await relay.drain();
      const before = await admin.query(
        `SELECT count(*)::int AS n FROM graphile_worker._private_jobs WHERE run_at <= now() AND attempts < max_attempts`,
      );
      if (relayed === 0 && before.rows[0].n === 0) return;
      await runOnce({
        pgPool: db.pool,
        taskList: buildTaskList(jobs.all()),
        noHandleSignals: true,
      });
    }
    throw new Error('System did not settle (job loop?)');
  }

  async function reset(): Promise<void> {
    adminAgent = null;
    const { rows } = await admin.query<{ t: string }>(
      `SELECT format('%I.%I', schemaname, tablename) AS t FROM pg_tables
        WHERE schemaname IN ('identity', 'notifications', 'membership', 'learning', 'clients', 'catalog', 'partners', 'itineraries', 'booking', 'payments')
          AND tablename <> ALL ($1)`,
      [SEED_TABLES],
    );
    await admin.query(`TRUNCATE ${rows.map((r) => r.t).join(', ')}, platform.outbox, platform.processed_events,
      platform.idempotency_keys, platform.webhook_inbox CASCADE`);
    await admin.query('DELETE FROM graphile_worker._private_jobs');
    if (redis.status === 'wait') await redis.connect();
    await redis.flushdb();
    mail.clear();
    for (const s of suppliers) {
      s.priceEpoch = 0;
      s.failing = false;
      s.hangMs = 0;
      s.soldOut.clear();
      s.reserveFailures = 0;
      s.rejectReserve = null;
      s.rejectWhen = null;
      s.reserveCalls.length = 0;
      s.amendFailures = 0;
      s.rejectAmend = false;
      s.amendCalls.length = 0;
    }
    const pay = app.get<FakePaymentProvider>(PAYMENT_PROVIDER);
    pay.failRefunds = null;
    pay.refundTransportFailures = 0;
    pay.intentTransportFailures = 0;
    app.get(SearchService).resetBreakers();
  }

  /** Signs up, verifies the email code and enrols MFA. Returns a cookie-carrying agent and the TOTP secret. */
  async function signUpAdvisor(email: string, password = 'correct horse battery staple') {
    const agent = request.agent(app.getHttpServer());
    const reg = await agent
      .post('/v1/auth/register')
      .send({ email, password, displayName: 'Ada' })
      .expect(201);
    await settle();
    const code = mail.lastCodeFor(email);
    if (!code) throw new Error('No verification code was emailed');
    await agent.post('/v1/auth/verify').send({ userId: reg.body.userId, code }).expect(200);
    const enroll = await agent.post('/v1/auth/mfa/enroll').expect(200);
    const confirm = await agent
      .post('/v1/auth/mfa/enroll/confirm')
      .send({ code: totp(enroll.body.secret, new Date()) })
      .expect(200);
    return {
      agent,
      userId: reg.body.userId as string,
      secret: enroll.body.secret as string,
      recoveryCodes: confirm.body.recoveryCodes as string[],
    };
  }

  let adminAgent: ReturnType<typeof request.agent> | null = null;

  /** Signed-in admin for this test (created once per reset). */
  async function admin1() {
    adminAgent ??= await signInAdmin();
    return adminAgent;
  }

  /**
   * Full AC-01 path to an Approved advisor (and Active with `essentials: true`): sign-up, MFA, application,
   * fake KYC + signature, plan with a waiver, admin acceptance.
   */
  async function onboardAdvisor(email: string, opts: { essentials?: boolean } = {}) {
    const a = await signUpAdvisor(email);
    const app = (await a.agent.post('/v1/advisor-application').send(application).expect(201)).body;
    await settle();
    const view = (await a.agent.get('/v1/advisor-application').expect(200)).body;
    await request(server())
      .post(`/v1/dev/fake-kyc/${view.kyc.redirectUrl.match(/fake-kyc\/([^?]+)/)[1]}/pass`)
      .expect(202);
    await request(server())
      .post(
        `/v1/dev/fake-signature/${view.agreement.signingUrl.match(/fake-signature\/(.+)$/)[1]}/sign`,
      )
      .expect(202);
    await settle();
    const adm = await admin1();
    await adm
      .post('/v1/admin/promo-codes')
      .send({ code: `W${Math.random().toString(36).slice(2, 10)}`, kind: 'waiver' })
      .expect(201)
      .then(async (r) => {
        await a.agent
          .post('/v1/membership/checkout')
          .set('Idempotency-Key', crypto.randomUUID())
          .send({ planCode: 'annual', promoCode: r.body.code, paymentMethodRef: 'pm_fake_visa' })
          .expect(200);
      });
    await adm
      .post(`/v1/admin/applications/${app.id}/decision`)
      .send({ decision: 'accept' })
      .expect(200);
    await settle();
    if (opts.essentials) await app_.get(IdentityApi).recordEssentialsPassed(app.id);
    return { ...a, advisorId: app.id as string };
  }

  /** Creates an admin and signs them in with MFA. */
  async function signInAdmin(email = 'admin@atp.test', password = 'admin password long enough') {
    await app.get(AuthService).createStaffUser({ email, password, role: 'admin' });
    await settle();
    const agent = request.agent(app.getHttpServer());
    await agent.post('/v1/auth/login').send({ identifier: email, password }).expect(200);
    const enroll = await agent.post('/v1/auth/mfa/enroll').expect(200);
    await agent
      .post('/v1/auth/mfa/enroll/confirm')
      .send({ code: totp(enroll.body.secret, new Date()) })
      .expect(200);
    return agent;
  }

  async function close(): Promise<void> {
    await admin.end();
    await app.close();
  }

  return {
    app,
    db,
    mail,
    admin,
    redis,
    http,
    settle,
    reset,
    signUpAdvisor,
    signInAdmin,
    admin1,
    onboardAdvisor,
    ingestCatalog,
    runJob,
    suppliers,
    close,
  };
}

export type TestApp = Awaited<ReturnType<typeof startApp>>;

/** An ISO date `days` from today (UTC). */
export function inDays(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

export const application = {
  legalName: 'Ada Lovelace',
  country: 'NG',
  address: { line1: '1 Marina', city: 'Lagos', postalCode: '101001' },
  taxResidency: 'NG',
  experience: 'none',
  niche: 'Family beach holidays',
};
