# Runbook: stuck pending bookings

**Signal:** `atp_bookings_stuck_pending > 0`, or the support queue (`GET /v1/support/bookings/stuck`) is not empty.
A stuck booking is one where the traveler has paid (or owes nothing now) and a hotel has not confirmed within 15 min.

**Do this:**

1. Open the queue entry: which hotel line is `pending`, how many `attempts`, which supplier.
2. If the supplier is down, follow [supplier-outage](supplier-outage.md). Retries continue on their own.
3. If the supplier is up and attempts are exhausted (8), the booking will fail and refund automatically. If you want
   to try again first, call `POST /v1/support/bookings/:id/retry` (support or admin); it re-queues the pending hotels
   with the same idempotency key, so it cannot double book.
4. If a job is in the dead-letter list (`GET /v1/admin/dead-letters`) for `booking.reserve-line`, fix the cause, then
   replay it (`POST /v1/admin/dead-letters/replay`).
5. Never edit booking rows by hand. If the supplier says a hotel IS booked but we show failed, escalate to the
   supplier-manager and finance: a compensating cancel or a manual statement entry is needed, not a database edit.
