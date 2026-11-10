'use client';

import Link from 'next/link';
import { isDemo } from '@/lib/demo/mode';

/** A small reminder, on every page of a demo deployment, that nothing here is real. */
export function DemoBanner() {
  if (!isDemo) return null;
  return (
    <div
      role="note"
      className="fixed bottom-3 left-3 z-50 flex items-center gap-3 rounded-full bg-ink px-4 py-2 text-xs text-white shadow-card"
    >
      <span>Demo · sample data, no backend</span>
      <Link href="/login" className="underline">
        Switch role
      </Link>
    </div>
  );
}
