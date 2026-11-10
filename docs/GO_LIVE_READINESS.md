# Go-live readiness

Honest status of what stands between this repository and a live launch. Everything marked **Done** is covered by
automated tests or a repeatable script; the rest needs a decision, an account, or work outside the code.

## Done (with evidence)

| Area          | What                                                                                                                                                                                    | Evidence                                                |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| Product scope | MVP flow end to end on fakes: onboarding, proposals, checkout, payments, booking, commission, ledger, payouts, AI assistant, reporting, admin                                           | 260+ API tests, per-sprint ADRs 08-21                   |
| Money         | Double-entry append-only ledger enforced by the database, idempotency at four levels, dual-approved payouts, clawback, reconciliation                                                   | ADR-17, ADR-18, `commission.test.ts`, `payouts.test.ts` |
| Security      | Every route audited: anonymous access, MFA enforcement, role scopes; security headers on API and web; body limits; production config refuses unsafe settings; `pnpm audit --prod` clean | `security-audit.test.ts`, ADR-21                        |
| Privacy       | Row-level security on advisor-owned data, privacy export and erasure, AI never reads another advisor's notes                                                                            | ADR-12, ADR-19                                          |
| Operations    | SLO metrics, alert rules, five runbooks, dead-letter replay, feature kill switches                                                                                                      | `docs/ops/`, `ops-metrics.test.ts`                      |
| Recovery      | Backup and restore drill script that proves counts and ledger balance                                                                                                                   | `scripts/restore-drill.sh`                              |
| Accessibility | WCAG 2.1 AA sweep, 25 pages, zero violations, no CSP problems                                                                                                                           | `scripts/a11y-sweep.cjs`                                |
| Provider swap | Contract suites every adapter must pass                                                                                                                                                 | `docs/ADAPTER_CONTRACTS.md`                             |

## Needs a decision from you

| #   | Decision                                                                      | Blocks                                                            |
| --- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| D1  | Launch region and currency                                                    | Cloud region, currencies, tax text, data residency (D10)          |
| D2  | Hotel inventory source                                                        | Real `HotelSupplierPort` adapter                                  |
| D3  | Who holds traveler funds (default: the platform)                              | Trust account or licensing work                                   |
| D4  | Payment and payout providers by advisor country                               | Real payment, billing and payout adapters, local-currency payouts |
| D5  | KYC and e-signature providers                                                 | Real identity adapters, signed agreement storage                  |
| D8  | Hosted language model (and whether client notes may leave our infrastructure) | Real `ModelPort`, assistant quality evaluation                    |
| D11 | Cloud provider                                                                | Infrastructure, secret store, WAF, backups                        |

## Needs accounts or infrastructure (not code)

Cloud account and environments (staging, production); managed Postgres with point-in-time recovery and Redis;
secret store holding `FIELD_ENCRYPTION_KEY`, provider keys and `METRICS_TOKEN`; domain, TLS and a WAF/DDoS layer in
front of the API and web app; the monitoring stack scraping `/metrics` with the alert rules; log shipping; CI with
container scanning; an email domain with SPF/DKIM; provider sandboxes and production credentials.

## Known gaps in the code

1. ~~No password reset~~ Fixed: email link (one use, one hour, stored hashed), throttled, ends every session on use;
   MFA is still required to sign in afterwards.
2. ~~Suspending or offboarding does not end sessions~~ Fixed: both end all of the person's sessions at once.
3. ~~Finance and support have no web sign-in~~ Fixed: the staff console shows each role only its own pages
   (finance: Finance and Reports; support: Privacy and Stuck bookings; admin: everything).
4. USD only: tiers, payouts and reports assume one currency; local-currency payouts are not built.
5. Contractor agreement PDF is not stored (needs the real e-sign provider); privacy policy and terms pages are not
   written; tax identifier collection with field encryption is available but not yet wired into onboarding.
6. Date and room changes on a confirmed booking (guest changes only today); traveler messaging thread (FR-TRV-06).
7. Load target of 1,000 concurrent users is unproven on real infrastructure (see `docs/ops/LOAD_TEST.md`).
8. Reporting facts start at deployment; earlier history needs an outbox replay.

## Before the pilot (100 advisors)

External penetration test; legal review of the agreement and policies; real-provider sandbox contract runs;
a restore drill on production infrastructure; a game-day for the supplier-outage and ledger-variance runbooks;
decide the pilot fee waiver (promo code `waiver` exists, FR-MEM-04) and its cap.
