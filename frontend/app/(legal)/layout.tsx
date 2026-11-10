import Link from 'next/link';
import type { ReactNode } from 'react';
import { Logo } from '@/components/shell';

/** Public legal pages: no account needed. */
export default function LegalLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen px-4 py-5 sm:px-8">
      <header className="flex items-center justify-between">
        <Logo />
        <nav aria-label="Legal" className="flex gap-4 text-sm">
          <Link className="underline" href="/privacy">
            Privacy
          </Link>
          <Link className="underline" href="/terms">
            Terms
          </Link>
        </nav>
      </header>
      <main id="main" className="mx-auto max-w-2xl py-8">
        <p role="note" className="mb-6 rounded-[14px] bg-warn-soft px-4 py-3 text-sm text-warn">
          Draft for legal review. This text describes what the platform does today and must be
          reviewed by counsel before any real user signs up.
        </p>
        <article className="flex flex-col gap-4 leading-relaxed [&_h1]:text-3xl [&_h2]:mt-4 [&_h2]:text-xl [&_ul]:list-disc [&_ul]:pl-6">
          {children}
        </article>
      </main>
    </div>
  );
}
