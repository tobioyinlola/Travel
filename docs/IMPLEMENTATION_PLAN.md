# Implementation Plan: Advisor Travel Platform (MVP)

Source documents (all dated Nov 9, 2026):

- **PRD**: Product Requirements Document (vision, scope by release, journeys, metrics, roadmap)
- **FRD**: Functional Requirements Document (numbered `FR-<MODULE>-<nn>` requirements, data model, state machines, NFRs, acceptance criteria AC-01..AC-10)
- **ARCH**: System Design and Architecture (modular monolith, module map, events, stack, ADR-01..07)

This plan turns those documents into a build order for the MVP (months 0-6). V1/V2 items are listed at the end only so we leave the right seams.

---

## 1. MVP definition of done

The PRD's MVP sentence is the acceptance bar: **a new advisor can sign up, learn, book a hotel for a real client, and get paid.**

Concretely, MVP ships when:

1. AC-01 through AC-10 (FRD) pass as automated end-to-end tests.
2. Every `M` + `MVP` requirement in the FRD (listed per module in section 5) is implemented.
3. NFRs that gate launch are met: NFR-01 (search p95 < 3 s), NFR-04 (99.9%), NFR-05 (RPO 15 min / RTO 4 h), NFR-06/07/09 (security, PCI scope), NFR-11 (zero unexplained ledger variance), NFR-12 (7-year audit log), NFR-13 (WCAG 2.1 AA).
4. Gate to V1 (PRD roadmap) can be measured: 100 pilot advisors, 20 anchor suppliers, payout time tracked.

---

## 2. Architecture we are building (from ARCH)

- **One modular monolith** (ADR-01): one codebase, one container image, two entry points (`web`, `worker`).
- **One PostgreSQL 16 cluster, one schema per module** (ADR-02); each module's DB role can write only its own schema; cross-schema references are bare UUIDs, no FKs with cascades.
- **Three communication mechanisms only**: in-process public-interface calls (downward only), domain events via **transactional outbox** (ADR-03), and background jobs on a **Postgres-backed queue** (ADR-04).
- **Append-only double-entry ledger** for money (ADR-05); integer minor units + ISO 4217.
- **SSE for real-time** (ADR-06); **ports and adapters** for every provider (ADR-07).

### Module map (13 modules, 4 layers) and FRD mapping

| Layer         | Module (ARCH)           | DB schema                                             | FRD codes covered              |
| ------------- | ----------------------- | ----------------------------------------------------- | ------------------------------ |
| Top           | Reporting               | `reporting`                                           | RPT                            |
| Top           | AI assistant            | `ai`                                                  | AI                             |
| Top           | Admin                   | `admin`                                               | ADM                            |
| Orchestration | Itineraries             | `itineraries`                                         | ITN, TRV (traveler link pages) |
| Orchestration | Booking                 | `booking`                                             | BKG (later CRZ, GRP, FLT)      |
| Orchestration | Commission and payments | `commission`, `payments`                              | PAY, COM                       |
| Core domain   | Clients                 | `clients`                                             | CRM                            |
| Core domain   | Catalog                 | `catalog`                                             | INV                            |
| Core domain   | Partners                | `partners`                                            | PRT                            |
| Core domain   | Membership              | `membership`                                          | MEM                            |
| Core domain   | Learning                | `learning`                                            | LRN, CMT                       |
| Foundation    | Identity                | `identity`                                            | AUTH                           |
| Foundation    | Notifications           | `notifications`                                       | NTF                            |
| Foundation    | Audit log               | `audit`                                               | FR-AUTH-09, NFR-12             |
| Foundation    | Shared kernel           | (none; plus `platform` schema for outbox/idempotency) | Money, IDs, event base types   |

Rules enforced in CI from day one: calls go **down** only; same-layer modules (e.g. Booking ↔ Commission) talk **only via events**; each module exports a single `index.ts`.

---

## 3. Stack decisions (ARCH defaults, made concrete)

| Concern                          | Choice                                                                                | Notes                                                                                                                                           |
| -------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Repo                             | pnpm workspaces + Turborepo monorepo                                                  | `apps/api`, `apps/web`, `packages/*`                                                                                                            |
| Backend                          | TypeScript, NestJS                                                                    | One Nest module per business module                                                                                                             |
| Migrations                       | Plain SQL per module, run as the module's DB role (ADR-08)                            | Postgres itself stops a migration from touching another schema. Typed query builder (Drizzle or Kysely) to decide in Sprint 1                   |
| Job queue                        | graphile-worker                                                                       | Jobs can be added with SQL inside the same transaction as business writes (ARCH requirement)                                                    |
| Event bus                        | `platform.outbox` + relay that fans each event out as one job per subscriber (ADR-09) | At-least-once delivery, exactly-once effect via `platform.processed_events`                                                                     |
| Cache / rate limit / idempotency | Redis                                                                                 | Idempotency records also persisted in Postgres for money paths                                                                                  |
| Search                           | Postgres full-text + `pg_trgm` + PostGIS (or earthdistance) for geo                   | FRD lists Elasticsearch; ARCH defers it. **We follow ARCH** until NFR-01 is at risk                                                             |
| Web                              | Next.js (App Router)                                                                  | Advisor portal, admin console, server-rendered traveler link pages                                                                              |
| API contract                     | OpenAPI generated from Nest decorators → typed client package                         | `packages/api-client`                                                                                                                           |
| Auth                             | Session cookies (httpOnly, SameSite) + TOTP MFA; argon2id                             | FRD says "OAuth 2.0 for the advisor web app"; ARCH says cookies for web, OAuth only for partners. **We follow ARCH**; partner OAuth is post-MVP |
| Boundary enforcement             | dependency-cruiser rules generated from `module-registry.json` + per-module DB roles  | Fails the build on violations                                                                                                                   |
| Module format                    | Native ES modules, TypeScript 6.0, Node 22 (ADR-10)                                   | NestJS 12 and graphile-worker 0.18 ship ESM only                                                                                                |
| Event contracts                  | Zod schemas, versioned, in `packages/contracts`                                       | Contract tests for producers/consumers                                                                                                          |
| Object storage                   | S3-compatible (MinIO locally)                                                         | Proposal PDFs, signed agreements, exports                                                                                                       |
| Observability                    | OpenTelemetry + pino JSON logs (PII redaction) + error tracker                        | Correlation id through requests, events and jobs                                                                                                |
| IaC / CI                         | Terraform; GitHub Actions; blue-green deploy                                          | Same image promoted dev → staging → prod                                                                                                        |
| Local dev                        | docker-compose: Postgres 16, Redis, MinIO, Mailpit                                    |                                                                                                                                                 |

---

## 4. Repository layout

```
/apps
  /api                      # NestJS: entry points main.web.ts, main.worker.ts
    /src/modules
      /shared-kernel        # Money, Id, Clock, DomainEvent, Result
      /identity  /notifications  /audit
      /clients  /catalog  /partners  /membership  /learning
      /itineraries  /booking  /commission  /payments
      /reporting  /ai  /admin
        <module>/
          index.ts          # the ONLY public surface (interface + DTOs + event types)
          /domain           # entities, state machines, pure logic
          /application      # use cases, event handlers, jobs
          /infrastructure   # repositories, adapters (ports live in /application)
          /http             # controllers
          /migrations       # this module's schema only
    /src/platform           # outbox, event bus, job registry, idempotency, db roles, otel
  /web                      # Next.js: (advisor) (admin) (traveler) route groups
/packages
  /contracts                # event schemas (zod), shared enums
  /api-client               # generated from OpenAPI
  /ui                       # shared components (accessible, WCAG 2.1 AA)
/infra                      # terraform, docker-compose
/docs                       # PRD/FRD/ARCH, ADRs, this plan, runbooks
```

---

## 5. Build sequence

Two-week sprints, 13 sprints ≈ 6 months. The strategy is a **walking skeleton first**: get lead → proposal → booking → commission → payout working end to end against **fake adapters** by Sprint 4, then replace fakes with real providers and fill in depth. This de-risks the two business-ending risks the PRD names (supplier access, money handling) and means open vendor decisions (section 7) do not block engineering.

### Sprint 0 (week 1-2): Foundations — DONE

Status: complete. See README and ADR-08..10. Not yet verified locally: Docker image builds (no Docker daemon in the build environment; CI builds them).

- Monorepo, lint, format, TS strict, test runner (Vitest), docker-compose.
- `platform`: DB connection per module role, transaction helper, outbox table + relay job, in-process event bus with idempotent-handler support, graphile-worker with `critical` / `default` / `bulk` queues, dead-letter + replay, `Idempotency-Key` middleware, problem-details errors, cursor pagination helper, correlation-id + OTel.
- `shared-kernel`: `Money` (bigint minor units + currency, banker's-safe rounding helper), typed IDs (UUIDv7), `DomainEvent<v>` base, `Clock`.
- Architecture tests (dependency-cruiser) and DB-role test proving a module cannot write another schema.
- CI: build, test, arch tests, dependency + container scanning, OpenAPI generation.
- Seed script and fixtures.

**Exit:** a dummy module can publish an event through the outbox and another can consume it exactly-once-effectively; violating an import rule fails CI.

### Sprint 1-2: Identity, Audit, Notifications, Membership (skeleton)

| Module        | Requirements                                                                                                                                                                                                                                                                                                                                                       |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity      | FR-AUTH-01 (email/phone + OTP), 02 (MFA, required for advisor/finance/admin), 03 (application form), 04 (KYC via `IdentityVerificationPort`; store result + ref only), 05 (contractor agreement via `SignaturePort`), 06 (status machine Applied → Under review → Approved → Active → Suspended → Offboarded), 07 (booking gate check exposed on public interface) |
| Audit         | FR-AUTH-09, NFR-12: append-only `audit.log`, partitioned by month, before/after values; insert-only DB role                                                                                                                                                                                                                                                        |
| Roles         | Server-side RBAC + ownership checks per FRD roles table; RLS on advisor-owned tables as defense in depth                                                                                                                                                                                                                                                           |
| Notifications | FR-NTF-01 (transactional email via `MessagingPort`), FR-NTF-05 (dedupe per event id)                                                                                                                                                                                                                                                                               |
| Membership    | FR-MEM-01 (configurable plans), 02 (charge on approval + invoice via `PaymentProviderPort`), 04 (promo codes / waivers with expiry), 07 (cancel at period end)                                                                                                                                                                                                     |
| Admin         | FR-ADM-01 (application review: approve / reject / request info)                                                                                                                                                                                                                                                                                                    |

Fakes: `FakeKyc`, `FakeSignature`, `FakePaymentProvider`, Mailpit for email.

### Sprint 2-3: Learning, Clients

| Module   | Requirements                                                                                                                                                                                 |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Learning | FR-LRN-01 (courses, lessons, quizzes, completion), FR-LRN-02 (Essentials passed → publishes event Identity uses for Active/booking gate), FR-CMT-01 (moderated forum, search, abuse reports) |
| Clients  | FR-CRM-01, 02 (preferences), 03 (trip history linked to bookings via events), 07 (ownership isolation), 08 (privacy export/delete job, 30-day target)                                        |

**Milestone (AC-01):** applicant → KYC → signed agreement → membership paid → Approved → Essentials passed → Active; booking blocked until then.

### Sprint 3-5: Catalog, Partners, Itineraries, Traveler link

| Module                          | Requirements                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Catalog                         | FR-INV-01 (content ingestion job from `HotelSupplierPort` into normalized catalog), 02 (property dedupe by geo + name + identifiers), 04 (search by destination, dates, occupancy, budget, brand, amenity; p95 < 3 s), 05 (live rate, taxes, fees, cancel policy, commission indicator), 06 (preferred-partner marking). Content cached hours, rates minutes, never cache final validation. Circuit breaker + "unconfirmed" marking for cached rates |
| Partners                        | FR-PRT-01 (programs: tier, commission rate, perks, eligibility), FR-PRT-02 (auto-attach perks/rate codes on `BookingConfirmed`). MVP list is admin-entered (PRD: "manual list of partner hotels")                                                                                                                                                                                                                                                    |
| Itineraries                     | FR-ITN-01 (day-by-day builder), 02 (add search results with rate/taxes/terms), 03 (totals incl. planning fee), 04 (signed, high-entropy, expiring link token scoped view/approve), 05 (rate expiry + "last checked"), 06 (approve / request changes / decline). Optimistic locking on edits. Proposal version locked on approval (AC-02)                                                                                                             |
| Traveler (in Itineraries + web) | FR-TRV-01, 02, 03: server-rendered no-login pages; pay + approve from the link using provider-hosted card fields                                                                                                                                                                                                                                                                                                                                     |

Fake: `FakeHotelSupplier` with a realistic seeded catalog, deterministic failure/timeout modes for tests.

### Sprint 4-6: Booking + Payments (critical path)

Implements ARCH "Booking to payout flow" steps 1-6 and the FRD booking state machine.

| Module        | Requirements                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Payments      | FR-PAY-01 (PCI-minimal: hosted fields, tokens only), FR-PAY-02 (hold traveler funds, refunds, chargebacks). Inbound webhook pipeline: verify signature → store raw → ack fast → process async → dedupe by provider event id. Emits `PaymentCaptured`                                                                                                                                                                                                                                                                                                      |
| Booking       | FR-BKG-01 (re-validate via Catalog interface; refuse stale → AC-03), 02 (traveler details), 03 (pay at hotel / deposit / prepay), 04 (reserve via worker job; store confirmation + raw response), 05 (modify/cancel with penalty shown), 06 (idempotency key → AC-04). State machine: Draft → Pending → Confirmed / Failed → Modified / Cancelled → Completed → Reversed; any other transition rejected. Per-supplier bulkhead queue, timeout, retry with jitter, circuit breaker. Stuck-Pending alert + support queue. `BookingFailed` → Payments refund |
| Notifications | Proposal published, booking confirmed/failed/cancelled emails; SSE channel for advisor live status                                                                                                                                                                                                                                                                                                                                                                                                                                                        |

**Milestone (Sprint 6):** full happy path and failure path with fakes: AC-02, AC-03, AC-04 green.

### Sprint 6-8: Commission, ledger, payouts

| Module     | Requirements                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Commission | FR-COM-01 (expected = commissionable × supplier rate), 02 (split by advisor tier **at recognition**, rounded to minor unit), 03 (Expected → Invoiced → Received → Reconciled → Payable → Paid, plus Reversed), 04 (supplier statement import + matching, mismatch flags), 05 (payable only after supplier pays), 06 (reverse / claw back), 07 (payout via `PayoutProviderPort` in local currency on schedule), 08 (itemized earnings statement), 09 (finance hold / release / adjust with reason code + audit) |
| Ledger     | Double-entry, append-only accounts (e.g. `supplier_receivable`, `platform_revenue`, `advisor_payable`, `cash_clearing`); corrections are reversing entries                                                                                                                                                                                                                                                                                                                                                     |
| Membership | FR-MEM-05 tier from calendar-year commissionable sales (consumes commission events); emits `TierChanged`                                                                                                                                                                                                                                                                                                                                                                                                       |
| Jobs       | Daily statement import, daily reconciliation (ledger = statements = payout provider; alert on any variance), payout run with **dual approval**                                                                                                                                                                                                                                                                                                                                                                 |
| Admin      | FR-ADM-05 finance tools (reconciliation view, payout runs, exports)                                                                                                                                                                                                                                                                                                                                                                                                                                            |

**Milestone:** AC-05 ($2,500 × 12% = $300 → $210 / $90), AC-06 (prospective tier upgrade at $300K), AC-07 (payout gate), AC-08 (clawback from next payout) green.

### Sprint 8-10: AI assistant, Reporting, remaining Admin

| Module     | Requirements                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| AI         | FR-AI-01 (RAG over catalog, partner notes, approved content, with source references), 03 (never sends to travelers; drafts require advisor approval → AC-09), 05 (log prompts, tool calls, outputs; advisor-visible controls), 06 (confidence + unverified-fact flags for prices/policies/perks), 08 (retrieval filtered by advisor → AC-10). `ModelPort` adapter; pgvector for the index (keeps "one datastore"); prompt-injection filtering on supplier text; AI indexing bulk job |
| Reporting  | FR-RPT-01 (advisor dashboard: pipeline, bookings, expected/paid commission, tier progress), 02 (finance reports), 03 (activation, time to first booking, active advisors, bookings by supplier), 06 (documented funnel event schema). Read models built from events; queries on read replica                                                                                                                                                                                         |
| Admin      | FR-ADM-02 (suspend/offboard + reassign open bookings), FR-ADM-04 (plans, split tiers, fees, programs, feature flags without deploy)                                                                                                                                                                                                                                                                                                                                                  |
| Membership | FR-MEM-03 (auto-renew, reminders, dunning job)                                                                                                                                                                                                                                                                                                                                                                                                                                       |

### Sprint 10-12: Real providers, hardening, launch readiness

- Swap fakes for contracted providers (hotel aggregator, payments, payouts, KYC, e-sign, email). Each adapter gets a contract test suite shared with its fake.
- Load test: 1,000 concurrent users, 10,000 advisors seeded (NFR-03); search p95 < 3 s (NFR-01); portal p95 < 2 s on 4G (NFR-02).
- Security: external pen test, WAF/DDoS, secret store, least-privilege roles, field-level encryption for tax identifiers, MFA enforcement audit.
- Accessibility audit (WCAG 2.1 AA).
- Ops: dashboards and alerts per ARCH SLO table (booking failure > 2% / 10 min, oldest critical job < 60 s, ledger variance = 0), runbooks (supplier outage, webhook backlog, stuck bookings, reconciliation variance), restore drill proving RPO/RTO.
- Pilot: 100 advisors, first-100 fee waiver (FR-MEM-04), feedback loop.

### Sprint 13: Buffer / pilot fixes

---

## 6. Cross-cutting checklists (apply in every sprint)

- Every state-changing endpoint accepts `Idempotency-Key`.
- Every event: past tense, versioned, IDs only, written to outbox in the same transaction.
- Every handler idempotent; every job retried with backoff then dead-lettered.
- Every external call: explicit timeout, request log with secrets stripped, never inside a DB transaction.
- Every money value: `Money` type, never `number`.
- Every permission check on the server; ownership checks in the module layer.
- Every sensitive action audited (logins, permission/status changes, payouts, impersonation).
- PII redacted from logs.

---

## 7. Decisions needed before / during build

Engineering can start without these (fakes cover them), but each has a "needed by" sprint.

| #   | Decision                                                                         | Source                   | Needed by                                      | Recommended default                                                                                                                                                    |
| --- | -------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| D1  | Launch region and licensing regime                                               | PRD open question        | Sprint 2 (KYC, tax forms, currency)            | One country, one currency for MVP                                                                                                                                      |
| D2  | Hotel inventory: aggregator vs direct                                            | PRD open question        | Sprint 3 (start integration), Sprint 10 (live) | Aggregator first (FRD assumption)                                                                                                                                      |
| D3  | Traveler funds: held by platform (merchant of record) vs paid direct to supplier | FRD open issue           | Sprint 4                                       | Determines trust-account / licensing work and whether `PaymentCaptured` precedes every booking. FR-BKG-03 "pay at hotel" bookings must skip payment capture regardless |
| D4  | Payments and payout providers by advisor country                                 | PRD, FRD                 | Sprint 4 (payments), Sprint 7 (payouts)        | Evaluate Stripe + Stripe Connect first; check country coverage                                                                                                         |
| D5  | KYC and e-sign providers                                                         | FRD                      | Sprint 10 (live)                               | Fakes until then                                                                                                                                                       |
| D6  | Pay advisors on supplier payment vs advance commission                           | PRD                      | Sprint 6                                       | On supplier payment (FR-COM-05, FRD assumption)                                                                                                                        |
| D7  | Tier upgrade prospective vs retroactive                                          | FRD open decision        | Sprint 6                                       | Prospective (FRD default, AC-06)                                                                                                                                       |
| D8  | AI: third-party hosted model vs own                                              | PRD                      | Sprint 8                                       | Hosted LLM behind `ModelPort` (ARCH)                                                                                                                                   |
| D9  | Membership fee collected up front or waived in pilot                             | PRD                      | Sprint 1                                       | Configurable; waiver via promo code                                                                                                                                    |
| D10 | Data residency for first region                                                  | FRD                      | Sprint 0 (cloud region)                        | Tied to D1                                                                                                                                                             |
| D11 | Cloud provider                                                                   | ARCH ("one major cloud") | Sprint 0                                       | Team familiarity                                                                                                                                                       |

### Inconsistencies found in the documents (resolve or confirm)

1. **Search engine**: FRD integrations table lists Elasticsearch/OpenSearch; ARCH says Postgres FTS at MVP. Plan follows ARCH.
2. **Web auth**: FRD "Public API" says OAuth 2.0 for the advisor web app; ARCH says session cookies for web, OAuth for partners. Plan follows ARCH.
3. **Membership charge timing**: FR-MEM-02 says charge "on approval"; AC-01 says payment succeeding is what moves status to Approved. Need one order (recommend: admin approves application → payment charged → Approved → Essentials → Active).
4. **Pay-at-hotel bookings**: ARCH booking flow always starts with `PaymentCaptured`; FR-BKG-03 allows payment at hotel. Booking must also start from `ProposalApproved` when no capture is needed.
5. **Module counts**: FRD has 15 modules, ARCH 13. Mapping in section 2 (TRV lives in Itineraries; CMT in Learning; PAY+COM in Commission and payments).
6. **Traveler messaging** (FR-TRV-06) is V1, but PRD traveler journey step 2 ("asks questions in the thread") is MVP. Confirm whether a minimal proposal comment thread is in MVP.

---

## 8. Seams to leave for V1/V2 (do not build now)

- Booking: supplier-type field and `CruiseSupplierPort` defined but unimplemented (CRZ, GRP V1; FLT V2).
- Catalog: `room_map_id` on rates now (FR-INV-03 room taxonomy is V1).
- Itineraries: version table from day one even though FR-ITN-07 history UI is V1.
- Identity: `agency_id` nullable on advisor (team accounts, FR-AUTH-10 V2).
- Notifications: channel abstraction ready for SMS/push (FR-NTF-03 V1).
- Multi-currency: `Money` carries currency everywhere even if MVP runs in one (NFR-14).
- Extraction candidates (ARCH): Catalog search, AI, Notifications, supplier workers — keep them strictly behind their interfaces.

---

## 9. Team allocation (PRD: ~14 people, 4 BE / 3 FE / 2 QA-DevOps)

| Stream                                         | Owners                             | Sprints                     |
| ---------------------------------------------- | ---------------------------------- | --------------------------- |
| Platform + foundations + infra                 | 1 BE + 1 DevOps                    | 0-2, then on-call/hardening |
| Identity, Membership, Learning, Admin          | 1 BE + 1 FE                        | 1-3, 8-10                   |
| Catalog, Partners, Itineraries, Traveler pages | 1 BE + 1 FE                        | 3-6                         |
| Booking, Payments, Commission, Ledger          | 1 BE (+ platform BE from Sprint 3) | 4-9                         |
| AI + Reporting                                 | shared BE + 1 FE                   | 8-10                        |
| QA (e2e AC suite, load, accessibility)         | 1 QA                               | continuous                  |

---

## 10. First concrete tasks (start here)

1. Initialize monorepo (`pnpm`, Turborepo, TS strict, ESLint, Prettier, Vitest).
2. `infra/docker-compose.yml`: Postgres 16 (with `pg_trgm`, `pgvector`), Redis, MinIO, Mailpit.
3. Scaffold `apps/api` NestJS with `main.web.ts` and `main.worker.ts`.
4. Implement `shared-kernel` (`Money`, IDs, `DomainEvent`) with unit tests.
5. Implement `platform` outbox + relay + event bus + graphile-worker queues + idempotency middleware.
6. Add dependency-cruiser layer rules and a per-module DB role migration; prove both fail on violation.
7. Scaffold empty module folders for all 13 modules with `index.ts` public interfaces.
8. Scaffold `apps/web` Next.js with three route groups and the generated API client.
9. GitHub Actions pipeline: install, lint, typecheck, test, arch tests, build image.
10. Write ADR-08 (per-module SQL migrations), ADR-09 (graphile-worker and outbox relay) and ADR-10 (ESM) to extend ARCH's decision log.

All ten are done (Sprint 0).
