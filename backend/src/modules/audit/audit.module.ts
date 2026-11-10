import { Module, OnModuleInit } from '@nestjs/common';
import { Database } from '../../platform/db/database.js';
import { JobRegistry } from '../../platform/jobs/job-registry.js';
import { AuditLog } from './application/audit-log.js';

/**
 * Audit module (foundation layer). Append-only audit trail retained 7 years (FR-AUTH-09, NFR-12).
 * Owns schema: audit.
 */
@Module({
  providers: [AuditLog],
  exports: [AuditLog],
})
export class AuditModule implements OnModuleInit {
  constructor(
    private readonly jobs: JobRegistry,
    private readonly db: Database,
  ) {}

  onModuleInit(): void {
    // Keep monthly partitions created ahead of time.
    this.jobs.register({
      name: 'audit.ensure-partitions',
      module: 'audit',
      queue: 'bulk',
      cron: '15 2 * * *',
      handle: () =>
        this.db
          .transaction('audit', (tx) => tx.query('SELECT audit.ensure_partitions(3)'))
          .then(() => undefined),
    });
  }
}
