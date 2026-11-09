import { Pool } from 'pg';
import { runOnce } from 'graphile-worker';
import { loadConfig } from '../src/config.js';
import { Database } from '../src/platform/db/database.js';
import { EventBus } from '../src/platform/events/event-bus.js';
import { OutboxRelay } from '../src/platform/events/outbox-relay.js';
import { createTxHooks } from '../src/platform/events/tx-hooks.js';
import { JobRegistry } from '../src/platform/jobs/job-registry.js';
import { buildTaskList, registerEventHandlerJobs } from '../src/platform/jobs/worker-runner.js';

export const config = () => loadConfig();

/** The platform wired by hand (no Nest), for fast integration tests. */
export function makePlatform() {
  const cfg = config();
  const jobs = new JobRegistry();
  const bus = new EventBus();
  const db = Database.fromUrl(cfg.DATABASE_URL, 5);
  db.setHooks(createTxHooks(jobs));
  const relay = new OutboxRelay(db, bus);
  const admin = new Pool({ connectionString: cfg.DATABASE_ADMIN_URL, max: 2 });
  return {
    db,
    jobs,
    bus,
    relay,
    admin,
    /** Register event-handler jobs, then run every runnable job once. */
    async runJobs(): Promise<void> {
      registerEventHandlerJobs(bus, jobs, db);
      await runOnce({
        pgPool: db.pool,
        taskList: buildTaskList(jobs.all()),
        noHandleSignals: true,
      });
    },
    async reset(): Promise<void> {
      await admin.query(`
        TRUNCATE platform.outbox, platform.processed_events, platform.idempotency_keys;
        DELETE FROM graphile_worker._private_jobs;
      `);
    },
    async close(): Promise<void> {
      await db.end();
      await admin.end();
    },
  };
}

export type TestPlatform = ReturnType<typeof makePlatform>;
