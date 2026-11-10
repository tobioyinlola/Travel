# Runbook: job backlog, undelivered events and dead letters

**Signals:** `atp_oldest_due_job_age_seconds{queue="critical"} > 60`, `atp_outbox_oldest_unrelayed_age_seconds > 120`,
`atp_dead_letters > 0`.

**Background:** events are written to the outbox in the same transaction as the change, a relay turns each into one
job per subscriber, and the worker runs them. Handlers are idempotent, so everything here can be retried.

**Critical queue late (reservations, webhooks, payouts, urgent email):**

1. Is the worker process up? `GET /v1/health` covers the API, not the worker: check the worker logs and process.
2. Raise `WORKER_CONCURRENCY_CRITICAL` if the worker is healthy but saturated; check the database is not the
   bottleneck (connections, locks).
3. A single failing job is retried with backoff and does not block others.

**Outbox not draining:** the relay runs inside the worker. If the worker is up and `atp_outbox_unrelayed` still
grows, look for repeated errors in the relay log (a malformed event fails validation against the catalog in
`packages/contracts`).

**Dead letters (Admin: `GET /v1/admin/dead-letters`):** read `lastError`, fix the cause (data, config, provider), then
replay with `POST /v1/admin/dead-letters/replay`. A job that fails again returns to the list. Replays are audited.
Typical causes: an event for a recipient that does not exist yet (retries usually fix it), a provider rejecting a
request, a bug. Never replay in bulk without reading the errors.
