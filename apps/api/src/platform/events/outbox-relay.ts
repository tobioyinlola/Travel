import type { EventEnvelope } from '@atp/contracts';
import { Database } from '../db/database.js';
import { PLATFORM } from '../modules.js';
import { DEFAULT_MAX_ATTEMPTS, JobEnvelope } from '../jobs/job-registry.js';
import { EventBus } from './event-bus.js';

interface OutboxRow {
  seq: string;
  id: string;
  type: string;
  version: number;
  producer: string;
  payload: Record<string, unknown>;
  correlation_id: string | null;
  occurred_at: Date;
}

/**
 * Moves committed events from the outbox to one job per subscriber, in a single transaction, so an event is
 * either fully fanned out or not at all. Safe to run in several worker processes (SKIP LOCKED).
 */
export class OutboxRelay {
  constructor(
    private readonly db: Database,
    private readonly bus: EventBus,
  ) {}

  /** Relays one batch; returns how many events were relayed. */
  async relayOnce(batchSize = 100): Promise<number> {
    return this.db.transaction(PLATFORM, async (tx) => {
      const rows = await tx.query<OutboxRow>(
        `SELECT seq, id, type, version, producer, payload, correlation_id, occurred_at
           FROM platform.outbox
          WHERE relayed_at IS NULL
          ORDER BY seq
          LIMIT $1
          FOR UPDATE SKIP LOCKED`,
        [batchSize],
      );
      for (const row of rows) {
        const envelope: EventEnvelope = {
          id: row.id,
          type: row.type,
          version: row.version,
          occurredAt: row.occurred_at.toISOString(),
          producer: row.producer,
          correlationId: row.correlation_id,
          payload: row.payload,
        };
        for (const sub of this.bus.subscribersOf(row.type, row.version)) {
          const job: JobEnvelope<EventEnvelope> = {
            meta: { correlationId: row.correlation_id },
            data: envelope,
          };
          await tx.query(
            `SELECT graphile_worker.add_job(identifier => $1, payload => $2::json,
                    max_attempts => $3, job_key => $4, job_key_mode => 'preserve_run_at')`,
            [
              EventBus.jobName(sub.handler),
              JSON.stringify(job),
              sub.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
              `${row.id}:${sub.handler}`,
            ],
          );
        }
      }
      if (rows.length > 0) {
        await tx.query(
          `UPDATE platform.outbox SET relayed_at = now() WHERE seq = ANY($1::bigint[])`,
          [rows.map((r) => r.seq)],
        );
      }
      return rows.length;
    });
  }

  /** Relays until the outbox is drained (tests, and catch-up after a backlog). */
  async drain(): Promise<number> {
    let total = 0;
    for (;;) {
      const n = await this.relayOnce();
      total += n;
      if (n === 0) return total;
    }
  }
}
