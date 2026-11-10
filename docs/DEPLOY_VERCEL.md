# Deploying the frontend on Vercel (demo, no backend)

The repository is a pnpm monorepo. Only `frontend/` is deployed; `backend/` is not needed for the demo.

1. In Vercel choose **Add New → Project** and import the GitHub repository.
2. **Root Directory:** `frontend`. Leave "Include source files outside of the Root Directory" **on** (it is the default),
   because the frontend uses the shared `packages/api-client`.
3. Everything else is read from `frontend/vercel.json`:
   - install: `cd .. && pnpm install --frozen-lockfile`
   - build: builds `packages/api-client`, then the app
   - `NEXT_PUBLIC_DEMO_MODE=1`, so the deployment runs on sample data with no backend
4. Deploy. Open the URL, pick a role on the sign-in page, and click through.

Node 22 is required (`engines` in `frontend/package.json`); set it under Project Settings → General if Vercel shows another version.

## Later: connect the real backend

Remove `NEXT_PUBLIC_DEMO_MODE` from `vercel.json` (or override it to `0` in the project's environment variables) and set
`NEXT_PUBLIC_API_BASE_URL` to the deployed API's address. Also add that address to the API's `WEB_ORIGINS`.
The backend needs Postgres and Redis and is deployed from `backend/Dockerfile`.

## Notes

- The demo is not a security boundary: anyone can pick any role. Do not put real data behind it.
- Proposal links in demo mode (`/p/anything`) show a sample proposal.
