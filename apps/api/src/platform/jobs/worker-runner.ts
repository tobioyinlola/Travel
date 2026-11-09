import { EventEmitter } from 'node:events';
import type { EventEnvelope } from '@atp/contracts';
import { parseCronItems, run, type Runner, type Task, type TaskList } from 'graphile-worker';
import type { Logger } from 'pino';
import { requestContext } from '../context/request-context.js';
import { Database } from '../db/database.js';
import type { QueueClass } from '../db/tx.js';
import { EventBus } from '../events/event-bus.js';
import { DEFAULT_MAX_ATTEMPTS, JobDefinition, JobEnvelope, JobRegistry } from './job-registry.js';

const QUEUES: QueueClass[] = ['critical', 'default', 'bulk'];

/** Turn every event subscription into a job definition (`event:<handler>`) with de-duplication. */
export function registerEventHandlerJobs(bus: EventBus, jobs: JobRegistry, db: Database): void {
  for (const sub of bus.all()) {
    const name = EventBus.jobName(sub.handler);
    if (jobs.get(name)) continue;
    jobs.register<EventEnvelope>({
      name,
      module: sub.module,
      queue: sub.queue ?? 'default',
      maxAttempts: sub.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
      handle: (event) =>
        db.transaction(sub.module, async (tx) => {
          const fresh = await tx.query(
            `INSERT INTO platform.processed_events (event_id, handler) VALUES ($1, $2)
             ON CONFLICT DO NOTHING RETURNING event_id`,
            [event.id, sub.handler],
          );
          if (fresh.length === 0) return; // already handled: at-least-once delivery, exactly-once effect
          await sub.handle(event, tx);
        }),
    });
  }
}

function toTask(def: JobDefinition): Task {
  return async (rawPayload, helpers) => {
    const envelope = (rawPayload ?? {}) as Partial<JobEnvelope>;
    const isCron = typeof rawPayload === 'object' && rawPayload !== null && '_cron' in rawPayload;
    const data = isCron ? rawPayload : envelope.data;
    const correlationId = envelope.meta?.correlationId ?? requestContext.newCorrelationId();
    await requestContext.run({ correlationId }, () =>
      def.handle(data, {
        jobId: helpers.job.id,
        attempts: helpers.job.attempts,
        maxAttempts: helpers.job.max_attempts,
        correlationId,
      }),
    );
  };
}

export function buildTaskList(defs: JobDefinition[]): TaskList {
  const list: TaskList = {};
  for (const def of defs) list[def.name] = toTask(def);
  return list;
}

export interface WorkerRunnerOptions {
  concurrency: Record<QueueClass, number>;
  pollInterval?: number;
}

/**
 * One graphile-worker runner per queue class, each with its own concurrency and only its own tasks,
 * so bulk ingestion can never starve a reservation (ARCH "Background jobs": critical/default/bulk).
 */
export class WorkerRunner {
  private runners: Runner[] = [];

  constructor(
    private readonly db: Database,
    private readonly jobs: JobRegistry,
    private readonly logger: Logger,
  ) {}

  async start(opts: WorkerRunnerOptions): Promise<void> {
    for (const queue of QUEUES) {
      const defs = this.jobs.byQueue(queue);
      if (defs.length === 0) continue;
      const events = new EventEmitter();
      events.on('job:error', ({ job, error }) => {
        const dead = job.attempts >= job.max_attempts;
        this.logger[dead ? 'error' : 'warn'](
          { job: job.task_identifier, jobId: job.id, attempts: job.attempts, err: error },
          dead ? 'job.dead_lettered' : 'job.failed_will_retry',
        );
      });
      const cron = defs
        .filter((d) => d.cron)
        .map((d) => ({ task: d.name, match: d.cron as string }));
      const runner = await run({
        pgPool: this.db.pool,
        concurrency: opts.concurrency[queue],
        pollInterval: opts.pollInterval ?? 1000,
        noHandleSignals: true,
        taskList: buildTaskList(defs),
        parsedCronItems: parseCronItems(cron),
        events: events as never,
      });
      this.runners.push(runner);
      this.logger.info({ queue, tasks: defs.map((d) => d.name) }, 'worker.queue_started');
    }
  }

  async stop(): Promise<void> {
    await Promise.all(this.runners.map((r) => r.stop()));
    this.runners = [];
  }
}
