import { Database } from '../db/database.js';

export interface DeadLetter {
  id: string;
  task: string;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  createdAt: Date;
}

/** Jobs that exhausted their retries. Backs the "replay" button in the admin console (ARCH jobs section). */
export class DeadLetterService {
  constructor(private readonly db: Database) {}

  async list(limit = 100): Promise<DeadLetter[]> {
    const r = await this.db.pool.query(
      `SELECT id::text, task_identifier, attempts, max_attempts, last_error, created_at
         FROM graphile_worker.jobs
        WHERE attempts >= max_attempts AND locked_at IS NULL
        ORDER BY created_at DESC
        LIMIT $1`,
      [limit],
    );
    return r.rows.map((row) => ({
      id: row.id,
      task: row.task_identifier,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      lastError: row.last_error,
      createdAt: row.created_at,
    }));
  }

  /**
   * Reset attempts to zero and run now. Calls the SQL function directly: WorkerUtils.rescheduleJobs in
   * graphile-worker 0.18 treats `attempts: 0` as "unchanged" (`0 || null`).
   */
  async replay(ids: string[]): Promise<number> {
    const r = await this.db.pool.query(
      `SELECT id FROM graphile_worker.reschedule_jobs($1::bigint[], run_at := now(), attempts := 0)`,
      [ids],
    );
    return r.rowCount ?? 0;
  }

  async release(): Promise<void> {
    // Nothing to release; kept so callers can treat this like other pooled services.
  }
}
