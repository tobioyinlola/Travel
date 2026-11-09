import type { ReactNode } from 'react';

/** Traveler link pages: server-rendered, no account, minimal chrome for fast loads on phones (NFR-02). */
export default function TravelerLayout({ children }: { children: ReactNode }) {
  return (
    <main id="main" className="mx-auto max-w-3xl px-4 py-8">
      {children}
    </main>
  );
}
