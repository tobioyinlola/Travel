'use client';

import type { ReactNode } from 'react';
import { Shell } from '@/components/shell';
import { useRequireRole } from '@/lib/session';

const NAV = [
  { href: '/application', label: 'Account' },
  { href: '/learn', label: 'Learn' },
  { href: '/clients', label: 'Clients' },
  { href: '/community', label: 'Community' },
];

/** Advisor portal: session cookie + MFA (enforced by the API; this guard only redirects). */
export default function AdvisorLayout({ children }: { children: ReactNode }) {
  const { me } = useRequireRole('advisor');
  return (
    <Shell area="Advisor portal" nav={NAV}>
      {me ? children : <p className="text-muted">Loading…</p>}
    </Shell>
  );
}
