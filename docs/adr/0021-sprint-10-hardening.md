# ADR-21: Sprint 10 decisions (hardening and launch readiness)

- Status: Accepted (Sprint 10)

## 1. Scope: everything that does not depend on provider choices

Swapping fakes for contracted providers needs decisions (D2-D5, D8) and credentials that are not available yet, and
sending real advisor or traveler data to a third party is a decision for the owner, not for the code. So Sprint 10
delivered the parts that make the swap safe and the launch operable, and left the adapters themselves for when the
providers are chosen. Nothing was sent to any external service.

## 2. Adapter contracts instead of adapters

One contract suite per port, run today against each fake; a real adapter must pass the same suite against the
provider's sandbox before `PROVIDERS_MODE=live` is allowed for it. The `live` branches still throw "not implemented"
on purpose, and production refuses `fake` mode.

## 3. Security by audit, not by trust

A test enumerates every route from the OpenAPI document and checks: only an explicit allowlist answers without a
session; a password-only session reaches nothing but the MFA routes (for advisor and admin); staff routes refuse
advisors and advisor routes refuse staff. It found one real defect (a public membership quote endpoint that let
anyone probe promo codes), fixed in this sprint. Headers: API (nosniff, frame deny, no-store, strict transport in
production, content policy `default-src 'none'`) and web (CSP confined to our origin, the API and hotel images).
Production config now also refuses development database passwords, plain-http origins and links, the default proxy
trust and a missing metrics token. Known gap found: there is no password-reset flow (listed in the readiness doc).

## 4. Operations

`GET /metrics` (token-protected, off when no token is set) exposes the ARCH SLIs: oldest due critical job, booking
failure ratio, stuck bookings, supplier circuits, ledger variance (must be exactly zero), webhook and outbox
backlogs, dead letters, plus request counts and latency by route template (never raw URLs, so link tokens stay out).
Modules register their own gauges and the platform only renders them. Dead letters can now be listed and replayed
from the admin API (audited). Alert rules and runbooks live in `docs/ops/`.

## 5. Evidence, including the unflattering kind

The load test meets every target at 200 users and shows no errors at 1,000, but the 1,000-user latency target is
not met on the shared 4-core development machine and more instances there do not help, so it is reported as unproven
rather than passed. The restore drill, accessibility sweep and dependency audit pass.
