import { Injectable, OnModuleInit } from '@nestjs/common';
import { Database } from './db/database.js';
import { JobRegistry } from './jobs/job-registry.js';
import { PLATFORM } from './modules.js';

/** Housekeeping jobs owned by the platform itself. */
@Injectable()
export class PlatformJobs implements OnModuleInit {
  constructor(
    private readonly jobs: JobRegistry,
    private readonly db: Database,
  ) {}

  onModuleInit(): void {
    this.jobs.register({
      name: 'platform.outbox-cleanup',
      module: PLATFORM,
      queue: 'bulk',
      cron: '30 3 * * *',
      handle: async () => {
        await this.db.transaction(PLATFORM, (tx) =>
          tx.query(`DELETE FROM platform.outbox WHERE relayed_at < now() - interval '14 days'`),
        );
      },
    });
    this.jobs.register({
      name: 'platform.idempotency-cleanup',
      module: PLATFORM,
      queue: 'bulk',
      cron: '45 3 * * *',
      handle: async () => {
        await this.db.transaction(PLATFORM, (tx) =>
          tx.query('DELETE FROM platform.idempotency_keys WHERE expires_at < now()'),
        );
      },
    });
  }
}
