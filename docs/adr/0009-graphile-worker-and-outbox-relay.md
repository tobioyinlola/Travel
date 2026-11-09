# ADR-09: graphile-worker for jobs; outbox relay fans events out as jobs

- Status: Accepted (Sprint 0)
- Extends: ADR-03 (transactional outbox), ADR-04 (Postgres-backed queue)

## Decision

- **Queue:** graphile-worker on the same Postgres cluster. Modules enqueue with
  `SELECT graphile_worker.add_job(...)` inside their own transaction (`tx.enqueue()`), so a job exists only
  if the business change committed.
- **Queue classes:** one runner per class (critical, default, bulk), each with its own concurrency and only
  its own task list. graphile-worker's `queue_name` is _not_ used for this, because it serialises jobs.
- **Events:** `tx.publish()` writes to `platform.outbox`. A relay loop in the worker process reads committed
  rows with `FOR UPDATE SKIP LOCKED` and, in one transaction, adds one job per subscriber
  (`event:<handler>`, job key `<eventId>:<handler>`) and marks the rows relayed.
- **Idempotent handlers:** each handler runs in a transaction under the subscribing module's role that first
  inserts `(event_id, handler)` into `platform.processed_events`; if the row exists the handler is skipped.
  Delivery is at-least-once; the effect is exactly once.
- **Dead letters:** jobs that exhaust `max_attempts` stay in the queue table, are logged at error level as
  `job.dead_lettered`, and can be listed and replayed through `DeadLetterService`.

## Notes found while implementing

- graphile-worker enables row-level security on its private tables without policies. The migration runner
  adds an `atp_access` policy for `atp_app` and the module roles after every graphile-worker migration.
- `WorkerUtils.rescheduleJobs({ attempts: 0 })` ignores zero (`0 || null`) in 0.18.0, so replay calls the
  `graphile_worker.reschedule_jobs` SQL function directly.

## Consequences

- Each event handler gets its own retries and dead-lettering; one failing subscriber does not block others.
- ARCH describes delivery as "in-process, in milliseconds". Delivery here is after commit plus the relay
  interval (250 ms default) plus job pickup. Revisit if a flow needs tighter latency.
