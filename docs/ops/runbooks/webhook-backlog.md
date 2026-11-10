# Runbook: webhook backlog

**Signals:** `atp_webhook_backlog` or `atp_webhook_oldest_unprocessed_age_seconds` high. Providers (payments, KYC,
e-sign) post signed events to `/webhooks/<provider>`. We store them, answer 200 at once and process them in a job.

**Meaning:** events are being received but not processed, so payments may be captured at the provider without our
booking moving, or KYC results are not applied.

**Do this:**

1. Check the worker is running and `atp_oldest_due_job_age_seconds{queue="critical"}` (the webhook job is critical).
   If the worker is down, restart it; the backlog clears by itself and nothing is lost (events are stored first).
2. If jobs run but fail, look in the dead letters for `platform.webhook-process` and read the error. A payment event
   whose amount does not match ours is deliberately parked (never guess with money): finance decides.
3. Never delete rows from `platform.webhook_inbox`; replays are de-duplicated by provider event id.
4. If the provider says it is retrying failed deliveries, that is fine: duplicates are ignored.
5. A signature failure (401 from us) means the signing secret is wrong or rotated: check the secret store.
