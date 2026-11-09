'use client';

import {
  GraduationCap,
  IdCard,
  LayoutGrid,
  Luggage,
  MessagesSquare,
  UserRound,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { AppShell, type NavItem } from '@/components/shell';
import { useRequireRole } from '@/lib/session';

const TABS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutGrid },
  { href: '/trips', label: 'Trips', icon: Luggage },
  { href: '/clients', label: 'Clients', icon: UserRound },
  { href: '/community', label: 'Community', icon: MessagesSquare },
];
const RAIL: NavItem[] = [
  { href: '/learn', label: 'Learn', icon: GraduationCap },
  { href: '/application', label: 'Account and membership', icon: IdCard },
];

/** Advisor portal (session cookie + MFA enforced by the API; this guard only redirects). */
export default function AdvisorLayout({ children }: { children: ReactNode }) {
  const { me } = useRequireRole('advisor');
  return (
    <AppShell tabs={TABS} rail={RAIL} accountHref="/application">
      {me ? children : <p className="text-muted">Loading…</p>}
    </AppShell>
  );
}
