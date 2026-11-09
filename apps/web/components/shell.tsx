import Link from 'next/link';
import type { ReactNode } from 'react';

/** Shared page frame with a skip link and landmark regions (WCAG 2.1 AA). */
export function Shell({ area, children }: { area: string; children: ReactNode }) {
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
          className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3"
        >
          <Link href="/" className="font-semibold text-brand-700">
            Advisor Travel Platform
          </Link>
          <span className="text-sm text-muted">{area}</span>
        </nav>
      </header>
      <main id="main" className="mx-auto max-w-5xl px-4 py-8">
        {children}
      </main>
    </>
  );
}
