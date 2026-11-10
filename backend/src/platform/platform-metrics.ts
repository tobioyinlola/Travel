import { Injectable, OnModuleInit } from '@nestjs/common';
import { Database } from './db/database.js';
import { JobRegistry } from './jobs/job-registry.js';
import { MetricsRegistry } from './metrics.js';
import { PLATFORM } from './modules.js';

/**
 * Platform-level SLIs from ARCH: how stale the job queues and the outbox are, jobs that gave up, and webhooks waiting
 * to be processed. Alert thresholds are in docs/ops/ALERTS.md.
 */
@Injectable()
export class PlatformMetrics implements OnModuleInit {
  constructor(
    private readonly db: Database,
    private readonly jobs: JobRegistry,
    private readonly metrics: MetricsRegistry,
  ) {}

  onModuleInit(): void {
    this.metrics.gauge(
      'atp_oldest_due_job_age_seconds',
      'Age of the oldest job that is due and not yet running, by queue class (SLO: critical < 60).',
      async () =>
        Promise.all(
          (['critical', 'default', 'bulk'] as const).map(async (queue) => {
            const tasks = this.jobs.byQueue(queue).map((j) => j.name);
            if (tasks.length === 0) return { value: 0, labels: { queue } };
            const r = await this.db.pool.query<{ age: string | null }>(
              `SELECT extract(epoch FROM now() - min(run_at))::text AS age FROM graphile_worker.jobs
                WHERE task_identifier = ANY($1) AND run_at <= now() AND attempts < max_attempts AND locked_at IS NULL`,
              [tasks],
            );
            return {
              value: Math.max(0, Math.round(Number(r.rows[0]?.age ?? 0))),
              labels: { queue },
            };
          }),
        ),
    );
    this.metrics.gauge(
      'atp_dead_letters',
      'Jobs that exhausted their retries and wait for a person.',
      async () => {
        const r = await this.db.pool.query<{ n: string }>(
          `SELECT count(*)::text AS n FROM graphile_worker.jobs WHERE attempts >= max_attempts AND locked_at IS NULL`,
        );
        return Number(r.rows[0]!.n);
      },
    );
    this.metrics.gauge(
      'atp_outbox_unrelayed',
      'Events written but not yet delivered to subscribers.',
      async () => {
        const [r] = await this.db.read<{ n: string }>(
          PLATFORM,
          `SELECT count(*)::text AS n FROM platform.outbox WHERE relayed_at IS NULL`,
        );
        return Number(r!.n);
      },
    );
    this.metrics.gauge(
      'atp_outbox_oldest_unrelayed_age_seconds',
      'Age of the oldest undelivered event.',
      async () => {
        const [r] = await this.db.read<{ age: string | null }>(
          PLATFORM,
          `SELECT extract(epoch FROM now() - min(occurred_at))::text AS age FROM platform.outbox WHERE relayed_at IS NULL`,
        );
        return Math.round(Number(r?.age ?? 0));
      },
    );
    this.metrics.gauge(
      'atp_webhook_backlog',
      'Provider webhooks received but not yet processed.',
      async () => {
        const [r] = await this.db.read<{ n: string }>(
          PLATFORM,
          `SELECT count(*)::text AS n FROM platform.webhook_inbox WHERE processed_at IS NULL`,
        );
        return Number(r!.n);
      },
    );
    this.metrics.gauge(
      'atp_webhook_oldest_unprocessed_age_seconds',
      'Age of the oldest unprocessed webhook.',
      async () => {
        const [r] = await this.db.read<{ age: string | null }>(
          PLATFORM,
          `SELECT extract(epoch FROM now() - min(received_at))::text AS age FROM platform.webhook_inbox WHERE processed_at IS NULL`,
        );
        return Math.round(Number(r?.age ?? 0));
      },
    );
  }
}
