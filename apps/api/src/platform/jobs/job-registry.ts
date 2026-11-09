import type { QueueClass } from '../db/tx.js';

export interface JobContext {
  jobId: string;
  attempts: number;
  maxAttempts: number;
  correlationId: string | null;
}

export interface JobDefinition<P = unknown> {
  /** Task identifier, namespaced by module: `booking.reserve`. */
  name: string;
  /** Owning module (for logs, code ownership, and the transaction role handlers usually use). */
  module: string;
  /** critical: reservations, webhooks, payouts; default: emails, imports; bulk: ingestion, indexing. */
  queue: QueueClass;
  maxAttempts?: number;
  /** Optional schedule in crontab syntax (UTC), e.g. '0 3 * * *'. */
  cron?: string;
  handle(payload: P, ctx: JobContext): Promise<void>;
}

/** Wire format for every job payload: business data plus tracing metadata. */
export interface JobEnvelope<P = unknown> {
  meta: { correlationId: string | null };
  data: P;
}

export const DEFAULT_MAX_ATTEMPTS = 10;

export class JobRegistry {
  private readonly jobs = new Map<string, JobDefinition>();

  register<P>(def: JobDefinition<P>): void {
    if (!/^[a-z][a-z0-9-]*(\.[a-zA-Z0-9_-]+)+$/.test(def.name) && !def.name.startsWith('event:')) {
      throw new Error(`Job name must be "<module>.<task>": ${def.name}`);
    }
    if (this.jobs.has(def.name)) throw new Error(`Job already registered: ${def.name}`);
    this.jobs.set(def.name, def as JobDefinition);
  }

  get(name: string): JobDefinition | undefined {
    return this.jobs.get(name);
  }

  byQueue(queue: QueueClass): JobDefinition[] {
    return [...this.jobs.values()].filter((j) => j.queue === queue);
  }

  all(): JobDefinition[] {
    return [...this.jobs.values()];
  }
}
