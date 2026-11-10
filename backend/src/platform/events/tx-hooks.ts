import { parseEventPayload } from '@atp/contracts';
import { newId, type DomainEventInput } from '../../modules/shared-kernel/index.js';
import { requestContext } from '../context/request-context.js';
import type { EnqueueOptions, Tx, TxHooks } from '../db/tx.js';
import { DEFAULT_MAX_ATTEMPTS, JobEnvelope, JobRegistry } from '../jobs/job-registry.js';

const PAST_TENSE = /^[A-Z][A-Za-z]*(ed|Paid|Sent|Done)$/;

export function createTxHooks(jobs: JobRegistry): TxHooks {
  return {
    async publish(tx: Tx, event: DomainEventInput): Promise<string> {
      if (!PAST_TENSE.test(event.type)) {
        throw new Error(`Event names are past-tense facts (e.g. BookingConfirmed): ${event.type}`);
      }
      const payload = parseEventPayload(event.type, event.version, event.payload);
      const id = newId();
      await tx.query(
        `INSERT INTO platform.outbox (id, type, version, producer, payload, correlation_id)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          id,
          event.type,
          event.version,
          tx.module,
          JSON.stringify(payload),
          requestContext.correlationId(),
        ],
      );
      return id;
    },

    async enqueue(
      tx: Tx,
      task: string,
      payload: unknown,
      options: EnqueueOptions = {},
    ): Promise<void> {
      const def = jobs.get(task);
      if (!def) throw new Error(`Unknown job: ${task}. Register it in the owning module first.`);
      const envelope: JobEnvelope = {
        meta: { correlationId: requestContext.correlationId() },
        data: payload,
      };
      await tx.query(
        `SELECT graphile_worker.add_job(
           identifier => $1, payload => $2::json, run_at => $3,
           max_attempts => $4, job_key => $5, priority => $6)`,
        [
          task,
          JSON.stringify(envelope),
          options.runAt ?? null,
          options.maxAttempts ?? def.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
          options.jobKey ?? null,
          options.priority ?? 0,
        ],
      );
    },
  };
}
