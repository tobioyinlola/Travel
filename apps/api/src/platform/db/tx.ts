import { PoolClient, QueryResultRow } from 'pg';
import type { DomainEventInput } from '../../modules/shared-kernel/index.js';

export type QueueClass = 'critical' | 'default' | 'bulk';

export interface EnqueueOptions {
  /** De-duplicates: a pending job with the same key is replaced instead of duplicated. */
  jobKey?: string;
  runAt?: Date;
  maxAttempts?: number;
  priority?: number;
}

export interface TxHooks {
  publish(tx: Tx, event: DomainEventInput): Promise<string>;
  enqueue(tx: Tx, task: string, payload: unknown, options?: EnqueueOptions): Promise<void>;
}

/**
 * A unit of work bound to one module's role. Events and jobs written through it commit or roll back
 * together with the business change (ARCH rules 6 and the jobs section).
 */
export class Tx {
  constructor(
    private readonly client: PoolClient,
    readonly module: string,
    private readonly hooks: TxHooks | undefined,
  ) {}

  async query<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<R[]> {
    const result = await this.client.query<R>(sql, params);
    return result.rows;
  }

  async one<R extends QueryResultRow = QueryResultRow>(
    sql: string,
    params: unknown[] = [],
  ): Promise<R> {
    const rows = await this.query<R>(sql, params);
    if (rows.length !== 1) throw new Error(`Expected exactly one row, got ${rows.length}`);
    return rows[0] as R;
  }

  /** Write a domain event to the outbox in this transaction. Returns the event id. */
  publish(event: DomainEventInput): Promise<string> {
    if (!this.hooks) throw new Error('Event publishing is not wired (PlatformModule not loaded)');
    return this.hooks.publish(this, event);
  }

  /** Enqueue a background job in this transaction. */
  enqueue(task: string, payload: unknown, options?: EnqueueOptions): Promise<void> {
    if (!this.hooks) throw new Error('Job enqueueing is not wired (PlatformModule not loaded)');
    return this.hooks.enqueue(this, task, payload, options);
  }
}
