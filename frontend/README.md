# Frontend (Next.js)

Advisor, admin, traveler and public pages. TypeScript, React 19, Next.js 16 (App Router), TanStack Query, Tailwind 4.

```
frontend/
  app/
    (auth)/       sign in, sign up, verify, MFA, forgot and reset password
    (advisor)/    advisor portal: dashboard, trips, clients, insights, earnings, community, assistant, learn, membership
    (admin)/      ALL staff features under /admin/*: applications, partners, moderation, privacy requests, advisors,
                  finance (reconciliation, payouts), reports, settings (flags, plans, tiers), promo codes, support queue
                  (a role sees only its own tabs: admin everything, finance Finance + Reports, support Privacy + Stuck bookings)
    (traveler)/   the private proposal link /p/[token]: proposal, decision, checkout, messages
    (legal)/      privacy and terms (drafts)
  components/     shared UI (design system in ui.tsx, app shell, thread, booking card, hotel search)
  lib/            API client, session and role helpers
  lib/demo/       demo mode: sample data with no backend (see below)
  scripts/        generate-demo-samples.mjs, demo-tour.cjs
```

## Run it

```bash
pnpm install
pnpm --filter @atp/api-client build
pnpm --filter @atp/web dev            # http://localhost:3000, expects the backend on :3001
```

## Demo mode (no backend)

With `NEXT_PUBLIC_DEMO_MODE=1` every API call is answered in the browser from sample data, so you can click through
every page without any server. The sign-in page then offers four roles (advisor, admin, finance, support).

```bash
pnpm --filter @atp/web demo:generate   # rebuild sample data after the API contract changes (reads backend/openapi.json)
NEXT_PUBLIC_DEMO_MODE=1 pnpm --filter @atp/web build && pnpm --filter @atp/web start
DEMO_URL=http://localhost:3000 node frontend/scripts/demo-tour.cjs   # visits every page as every role
```

Demo data comes from the API's OpenAPI contract, so its shapes always match the real responses. Writes "succeed" but
are not remembered. Nothing in demo mode contacts a server.

## Deploy on Vercel

See `docs/DEPLOY_VERCEL.md`.
