'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { ReactNode } from 'react';
import { api } from '@/lib/api';
import { useMe, useRefreshMe } from '@/lib/session';

/** Shared page frame with a skip link and landmark regions (WCAG 2.1 AA). */
export function Shell({
  area,
  children,
  nav,
}: {
  area: string;
  children: ReactNode;
  nav?: Array<{ href: string; label: string }>;
}) {
  const { data: me } = useMe();
  const refresh = useRefreshMe();
  const router = useRouter();
  async function signOut() {
    await api.POST('/v1/auth/logout');
    await refresh();
    router.push('/login');
  }
  return (
    <>
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:bg-surface focus:px-3 focus:py-2"
      >
        Skip to content
      </a>
      <header className="border-b border-gray-200 bg-surface">
        <nav
          aria-label="Primary"
          className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3"
        >
          <div className="flex items-center gap-5">
            <Link href="/" className="font-semibold text-brand-700">
              Advisor Travel Platform
            </Link>
            {nav?.map((n) => (
              <Link
                key={n.href}
                href={n.href}
                className="text-sm text-ink underline-offset-4 hover:underline"
              >
                {n.label}
              </Link>
            ))}
          </div>
          <div className="flex items-center gap-3 text-sm text-muted">
            <span>{area}</span>
            {me && (
              <button
                onClick={signOut}
                className="text-brand-700 underline-offset-4 hover:underline"
              >
                Sign out
              </button>
            )}
          </div>
        </nav>
      </header>
      <main id="main" className="mx-auto max-w-5xl px-4 py-8">
        {children}
      </main>
    </>
  );
}
