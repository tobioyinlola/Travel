# Advisor Travel Platform

Host-agency platform for independent travel advisors: onboarding, client CRM, proposals, hotel booking,
commission and payouts. Built as a **modular monolith** (see `docs/source/ARCH.pdf`).

- Plan: [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md)
- Decisions: [`docs/adr/`](docs/adr) (ADR-01..07 are in the architecture document)
- Source documents: `docs/source/` (PRD, FRD, ARCH)

## Stack

| Part                  | Tech                                                                                           |
| --------------------- | ---------------------------------------------------------------------------------------------- |
| Backend (`apps/api`)  | Node.js 22, TypeScript, NestJS 12, PostgreSQL 16, graphile-worker, Redis                       |
| Frontend (`apps/web`) | TypeScript, React 19, Next.js 16 (App Router), TanStack Query, Tailwind CSS 4                  |
| Shared                | `packages/contracts` (versioned event schemas), `packages/api-client` (generated from OpenAPI) |

## Getting started

Requirements: Node 22.18+, pnpm 10, Docker (or local Postgres 16 and Redis 7).

```bash
pnpm install
```

```bash
docker compose -f infra/docker-compose.yml up -d
```

```bash
cp .env.example .env
```

```bash
pnpm --filter @atp/contracts build && pnpm db:migrate
```

Run the API, the worker and the web app (three terminals):

```bash
pnpm --filter @atp/api dev
```

```bash
pnpm --filter @atp/api dev:worker
```

```bash
pnpm --filter @atp/web dev
```

- Web: http://localhost:3000
- API: http://localhost:3001/v1/health, docs at http://localhost:3001/docs
- Mail: http://localhost:8025 (Mailpit)

## Everyday commands

| Command                        | What it does                                                              |
| ------------------------------ | ------------------------------------------------------------------------- |
| `pnpm test`                    | Unit and integration tests (needs Postgres and Redis; creates `atp_test`) |
| `pnpm lint` / `pnpm typecheck` | ESLint and TypeScript across the workspace                                |
| `pnpm arch:check`              | Fails on imports that break module boundaries                             |
| `pnpm db:migrate`              | Bootstrap roles and schemas, then apply module migrations                 |
| `pnpm api-client:generate`     | Re-export OpenAPI from the API and regenerate the typed client            |

Create the first admin (the password comes from the environment so it stays out of shell history):

```bash
STAFF_PASSWORD='choose a long password' pnpm --filter @atp/api create-staff --email you@example.com --role admin
```

## Trying the onboarding flow locally

Providers run as fakes (`PROVIDERS_MODE=fake`):

- **Email:** with Mailpit running, codes and emails appear at http://localhost:8025. Without Mailpit, set
  `MAIL_TRANSPORT=log` for the API and worker and read them from the worker's output.
- **Identity verification and contract signing:** the application page links to test-mode provider pages
  (`/dev/fake-kyc/...`, `/dev/fake-signature/...`) where you choose the outcome.
- **Cards:** `pm_fake_visa` succeeds, `pm_fake_declined` is declined. No real card is charged.

Flow: sign up at `/signup`, verify the code, set up MFA, submit the application, complete both checks,
choose a plan, then accept the application as an admin at `/admin/applications`.

## How the backend is organised

```
apps/api/src
  module-registry.json   # every module and its layer: the source of truth for boundaries and DB roles
  platform/              # outbox, event bus, jobs, DB roles, idempotency, errors, logging
  modules/<module>/
    index.ts             # the ONLY file other modules may import
    domain/ application/ infrastructure/ http/
    migrations/*.sql     # run as this module's DB role; cannot touch other schemas
```

Rules, all enforced automatically:

1. A module calls only modules in a **lower layer**, and only through their `index.ts`
   (`pnpm arch:check`). Same-layer and upward communication uses **domain events**.
2. Each module's database role can write **only its own schema**. The app's login role has no table
   access; every unit of work runs `db.transaction('<module>', tx => ...)`.
3. Events and jobs are written in the **same transaction** as the change: `tx.publish(...)`,
   `tx.enqueue(...)`. Event handlers are idempotent by construction.
4. Money is `Money` (bigint minor units + ISO 4217), never `number`.
5. State-changing endpoints accept `Idempotency-Key`; money endpoints require it
   (`@RequireIdempotencyKey()`).
6. Errors are RFC 9457 problem details; every response carries `x-correlation-id`.

### Publishing and handling an event

```ts
// Producer (inside its own transaction)
await db.transaction('booking', async (tx) => {
  await tx.query('UPDATE booking.bookings SET status = $2 WHERE id = $1', [id, 'Confirmed']);
  await tx.publish({
    type: 'BookingConfirmed',
    version: 1,
    payload: { bookingId: id, tripId, advisorId, supplierId },
  });
});

// Consumer (register in the module's onModuleInit)
bus.subscribe({
  module: 'notifications',
  handler: 'notifications.sendBookingConfirmation',
  event: 'BookingConfirmed',
  version: 1,
  handle: async (event, tx) => {
    /* runs once per event, under the notifications role */
  },
});
```

Event payload schemas live in `packages/contracts/src/events/catalog.ts`.
