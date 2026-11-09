'use client';

import type { ReactNode } from 'react';
import { Shell } from '@/components/shell';
import { useRequireRole } from '@/lib/session';

const NAV = [
  { href: '/admin/applications', label: 'Applications' },
  { href: '/admin/moderation', label: 'Moderation' },
  { href: '/admin/privacy', label: 'Privacy requests' },
  { href: '/admin/promo-codes', label: 'Promo codes' },
];

/** Admin console: role-scoped, MFA required (enforced by the API). */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const { me } = useRequireRole('admin');
  return (
    <Shell area="Admin console" nav={NAV}>
      {me ? children : <p className="text-muted">Loading…</p>}
    </Shell>
  );
}
