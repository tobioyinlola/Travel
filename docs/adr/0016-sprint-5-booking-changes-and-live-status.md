# ADR-16: Sprint 5 decisions (booking changes and live status)

- Status: Accepted (Sprint 5)

## 1. What "modify" means in this release

A confirmed booking's lead guest (name, email, phone, special requests) can be changed by the advisor
(`PATCH /v1/bookings/:id/guest`, Idempotency-Key required). Date, room or party changes need a new price and
possibly a payment top-up or refund; until that is designed with a real supplier, the way to change them is
cancel (penalty quoted first) and book again from a new proposal.

Flow: confirmed -> modified (our record changes at once) -> one `booking.amend-line` job per hotel, keyed by
`<line>:amend:<version>` so retries are idempotent -> when every hotel has answered, modified -> confirmed
(`reconfirm`). A newer change supersedes an older one still in flight (version check). A hotel that refuses (or
stays unreachable through the last retry) is flagged on its line and the advisor gets an email
(`BookingModificationFailed`); the booking stays confirmed because the reservation itself is intact. Guest
changes are not rolled back at hotels that accepted them. One change at a time; not while cancelling.

## 2. Live status

`BookingUpdated` (internal, after-commit via the outbox) is relayed through Redis pub/sub to
`GET /v1/bookings/stream`, a Server-Sent Events endpoint per signed-in advisor (heartbeat every 25 s). Messages
carry only ids and status; the browser re-fetches through the normal access-checked API. Polling stays as a slow
fallback. Delivery is at-least-once and best effort: a missed message is repaired by the next fetch or poll.

## Moved to Sprint 6

Partner perk auto-attach on `BookingConfirmed` (FR-PRT-02) is built together with commission, because perks and
rates share the program record and the booking lines will then carry property ids and rate codes.
