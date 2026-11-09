import type { INestApplication } from '@nestjs/common';
import { runOnce } from 'graphile-worker';
import type { Redis } from 'ioredis';
import { Pool } from 'pg';
import request from 'supertest';
import { loadConfig } from '../src/config.js';
import { createHttpApp } from '../src/http-app.js';
import { MESSAGING_PORT, MemoryMessaging } from '../src/modules/notifications/index.js';
import { totp } from '../src/modules/identity/domain/totp.js';
import { AuthService } from '../src/modules/identity/index.js';
import { Database } from '../src/platform/db/database.js';
import { EventBus } from '../src/platform/events/event-bus.js';
import { OutboxRelay } from '../src/platform/events/outbox-relay.js';
import { JobRegistry } from '../src/platform/jobs/job-registry.js';
import { buildTaskList } from '../src/platform/jobs/worker-runner.js';
import { REDIS } from '../src/platform/tokens.js';

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
    const { rows } = await admin.query<{ t: string }>(
      `SELECT format('%I.%I', schemaname, tablename) AS t FROM pg_tables
        WHERE schemaname IN ('identity', 'notifications', 'membership') AND tablename <> 'plans'`,
    );
    await admin.query(`TRUNCATE ${rows.map((r) => r.t).join(', ')}, platform.outbox, platform.processed_events,
      platform.idempotency_keys, platform.webhook_inbox CASCADE`);
    await admin.query('DELETE FROM graphile_worker._private_jobs');
    if (redis.status === 'wait') await redis.connect();
    await redis.flushdb();
    mail.clear();
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

  return { app, db, mail, admin, redis, http, settle, reset, signUpAdvisor, signInAdmin, close };
}

export type TestApp = Awaited<ReturnType<typeof startApp>>;

export const application = {
  legalName: 'Ada Lovelace',
  country: 'NG',
  address: { line1: '1 Marina', city: 'Lagos', postalCode: '101001' },
  taxResidency: 'NG',
  experience: 'none',
  niche: 'Family beach holidays',
};
