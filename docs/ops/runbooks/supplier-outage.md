# Runbook: supplier outage

**Signals:** `atp_supplier_circuit_open == 1` for a supplier; `atp_booking_failure_ratio_10m` rising; search results
show a warning naming the supplier.

**What the system does by itself:** every supplier call has a 2.5 s (search) or 10 s (booking) timeout and its own
circuit breaker (opens after 5 consecutive failures, tries once after 30 s). Search keeps showing the other
suppliers. Booking jobs retry 8 times with backoff using the same idempotency key; if the last retry fails the
booking fails, the traveler is refunded and the advisor is emailed.

**Do this:**

1. Confirm it is the supplier, not us: other suppliers fine, health OK.
2. If bookings are failing for travelers who have paid, pause new bookings: Admin > Settings > "new bookings" off.
   Viewing proposals still works. Turn it back on when the supplier recovers.
3. Do not retry failed bookings by hand: a failed booking is already refunded. The advisor can reprice and resend.
4. Pending bookings that are still retrying need nothing; after recovery the next retry confirms them. After 15 min
   they appear in the support queue (`GET /v1/support/bookings/stuck`); see [stuck-bookings](stuck-bookings.md).
5. After recovery, check `atp_supplier_circuit_open` returns to 0 and the failure ratio falls.
6. Afterwards list bookings that failed in the window and tell the advisors who did not get the email (check the
   notification log).
