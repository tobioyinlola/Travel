'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { api, call } from '@/lib/api';
import { DEMO_ROLES, isDemo } from '@/lib/demo/mode';
import { nextPath, useRefreshMe } from '@/lib/session';

/** Demo mode only: jump straight into the app as any role, with sample data and no backend. */
export function DemoRoles() {
  const router = useRouter();
  const refresh = useRefreshMe();
  const [busy, setBusy] = useState<string | null>(null);
  if (!isDemo) return null;

  async function enter(email: string, role: string) {
    setBusy(role);
    const me = await call(
      api.POST('/v1/auth/login', { body: { identifier: email, password: 'demo' } }),
    );
    await refresh();
    router.push(nextPath(me));
  }

  return (
    <section aria-labelledby="demo-h" className="mb-8 rounded-[24px] bg-accent-soft p-5">
      <h2 id="demo-h" className="text-lg">
        Explore the demo
      </h2>
      <p className="mb-3 text-sm text-ink">
        Sample data, no sign-in needed. Pick a role to click through every page.
      </p>
      <ul className="grid gap-2 sm:grid-cols-2">
        {DEMO_ROLES.map((r) => (
          <li key={r.role}>
            <button
              type="button"
              disabled={busy !== null}
              onClick={() => void enter(r.email, r.role)}
              className="flex w-full flex-col rounded-[18px] bg-surface px-4 py-3 text-left ring-1 ring-line hover:bg-white/70 focus-visible:outline-2 focus-visible:outline-accent-strong"
            >
              <span className="font-medium">{busy === r.role ? 'Opening…' : r.label}</span>
              <span className="text-xs text-muted">{r.blurb}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
