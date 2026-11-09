# ADR-13: Sprint 3 decisions (catalog, partners, itineraries)

- Status: Accepted (Sprint 3)

## 1. Two fake wholesalers until the inventory source is chosen (decision D2)

`HotelSupplierPort` has two in-process adapters with invented hotels across 8 launch destinations. Their content
deliberately disagrees (names formatted differently, coordinates tens of metres apart, a shared identifier
on only some hotels) so de-duplication is exercised for real. Prices are deterministic per hotel, date and
party; tests move them with `priceEpoch` and sell rooms out with `soldOut`.

## 2. De-duplication (FR-INV-02)

A shared industry identifier wins. Otherwise a hotel within 250 m whose normalised name has a bigram
similarity of at least 0.6 is the same property. Two different shared identifiers are never merged.
Suppliers ingest in parallel, so catalog writes take a transaction-level advisory lock: without it two feeds
created the same hotel at once (found in the browser run; covered by a concurrency test).

## 3. Search resilience

Every supplier call has a 2.5 s timeout and its own circuit breaker (opens after 5 consecutive failures,
one trial after 30 s). A failing supplier is reported in `warnings` and the others' results still show
(degraded mode). Supplier rate responses are cached in Redis for 2 minutes; `checkRate` (used when adding a
hotel to a trip, publishing and refreshing) never uses the cache.

## 4. Preferred partners reach search by event

Catalog and Partners are both core-domain modules, so Catalog cannot call Partners. Partners publishes
`PartnerProgramChanged` with the program's state (properties, perks, rate codes, effective flag) and Catalog
keeps a projection. Programs with rate codes apply perks only to matching rates; no codes means every rate.
A daily job re-announces programs whose validity window starts or ends.

## 5. Proposals

- A trip is for one of the advisor's own clients, in one currency, for one party; hotels must match the
  party and fall within the trip dates, because booking needs the exact occupancy.
- Publishing re-checks every hotel live, refuses sold-out ones, and stores an immutable snapshot (versioned).
- The link token is 32 random bytes: stored as SHA-256 for lookup and AES-GCM encrypted so the advisor can
  copy it again. A new version keeps the same link. Links expire after 30 days, prices after 24 hours
  (`PROPOSAL_RATE_TTL_HOURS`). Expired prices block approval until the advisor re-checks; unchanged prices
  are extended, changed prices publish a new version.
- The traveler view leaves out rate keys, suppliers, rate codes and commission.
- `ProposalSent` carries the link (like verification codes); the message log stores it redacted.
- Approval locks the trip (no edits, no new versions) until booking (Sprint 4).
- Public link endpoints are rate-limited per client IP. The traveler page is server-rendered, so the API now
  honours `X-Forwarded-For` from trusted proxies (`TRUST_PROXY`, default loopback).

## Not done in Sprint 3

Payment from the proposal link (FR-TRV-03) arrives with Payments in Sprint 4. Multi-room searches,
room-type mapping across suppliers (FR-INV-03, V1) and rate parity checks (FR-INV-07, V1) are not built.
