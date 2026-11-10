import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/shell';

/** Traveler link pages: server-rendered, no account, light chrome for fast loads on phones (NFR-02). */
export default function TravelerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen px-4 py-5 sm:px-8">
      <header>
        <Logo />
      </header>
      <main id="main" className="mx-auto max-w-3xl py-8">
        {children}
      </main>
      <footer className="mx-auto max-w-3xl pb-6 text-xs text-muted">
        <Link className="underline" href="/privacy">
          Privacy
        </Link>{' '}
        ·{' '}
        <Link className="underline" href="/terms">
          Terms
        </Link>
      </footer>
    </div>
  );
}
