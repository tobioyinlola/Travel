# ADR-15: Sprint 4 decisions (booking and payments)

- Status: Accepted (Sprint 4)

## 1. Booking and Payments are same-layer modules: they talk by events

Both sit in the orchestration layer, so neither may call the other, nor Itineraries. The flow is:
`ProposalApproved` (now carries the hotel lines and the SHA-256 of the link token) -> Booking prepares a draft ->
traveler submits -> `BookingPaymentRequested` -> Payments creates the intent -> `PaymentIntentCreated` ->
traveler pays with the provider's hosted fields -> signed webhook -> `PaymentCaptured` -> Booking reserves each
hotel from a job -> `BookingConfirmed` / `BookingFailed`. Payments refunds on `BookingFailed` and
`BookingCancelled`. Itineraries moves the trip (booked / planning / cancelled) from the same events.
All event changes are additive optional fields in v1; the new events are `BookingPaymentRequested`,
`PaymentIntentCreated`, `PaymentFailed`, `RefundIssued`, `PaymentDisputed`, `BookingBlocked`, `BookingDiscarded`.

## 2. Decisions taken by default (open items D2, D3, D4 still need a human answer)

- D3: the platform holds traveler funds. Pay-at-hotel bookings skip payment entirely (plan inconsistency #4).
- D4/D2: payments and suppliers sit behind `PaymentProviderPort` and `HotelSupplierPort` with fakes. The fake
  provider and its hosted-card page exist only with `PROVIDERS_MODE=fake`. Card data never reaches our servers.
- The payable amount covers hotels only. Activities, transfers and the planning fee stay advisor-billed for now.
- Deposit mode collects 20% of each hotel now and the remainder is paid at the property.

## 3. Booking state machine and sagas

`draft -> pending -> confirmed | failed -> modified -> cancelled -> completed -> reversed`, enforced by the shared
`StateMachine`; every other transition throws (unit-tested exhaustively). Draft means the traveler has not
committed; pending means money is captured (or nothing is due) and suppliers are being asked.
Multi-hotel bookings: all hotels confirmed -> confirmed; any refused -> failed, hotels already confirmed are
cancelled again (compensation) and the traveler is refunded in full. A compensating cancel can cost a penalty;
the platform bears it, it is logged at error level and audited (`booking.compensation_penalty`).
Modify (`modified`) and reversal are modelled but their endpoints arrive in Sprints 5 and 6.

## 4. Idempotency (AC-04) at four levels

HTTP `Idempotency-Key` (required on confirm and cancel); `bookings.proposal_id` unique (one booking per proposal);
the supplier call carries `<booking>:<line>` on every retry; webhook inbox de-duplicates by provider event id and
refunds are keyed by cause. Late or duplicate captures are refunded automatically (`booking_closed`).

## 5. Stale prices (AC-03)

Checkout prices every hotel again with its supplier (never cached). A moved price or sold-out room is refused
with 409, the advisor is emailed once (`BookingBlocked`) and can discard the unpaid draft, which reopens the
trip and supersedes the proposal. Supplier outages answer 503 without alerting the advisor.

## 6. Resilience

Reserve and cancel run in `critical` jobs (8 attempts, backoff) outside any transaction, through the catalog's
per-supplier circuit breaker with a 10 s timeout. When the last attempt fails the line fails with
`supplier_unavailable`. Pending bookings older than 15 minutes appear in the support queue
(`GET /v1/support/bookings/stuck`, retry endpoint) and are logged every five minutes. A true per-supplier job
queue (bulkhead) and jittered retries are not built: graphile-worker retries use plain exponential backoff.

## Known limits

Client secrets for hosted fields travel in an outbox event (like verification codes). Refund failures are logged
and audited but have no finance console yet (Sprint 7). Traveler-initiated cancellation goes through the advisor.
