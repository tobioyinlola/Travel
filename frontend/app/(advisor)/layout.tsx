'use client';

import {
  BadgeDollarSign,
  ChartColumn,
  GraduationCap,
  IdCard,
  LayoutGrid,
  Sparkles,
  Luggage,
  MessagesSquare,
  UserRound,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { AppShell, type NavItem } from '@/components/shell';
import { api, call } from '@/lib/api';
import { useRequireRole } from '@/lib/session';

const TABS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: LayoutGrid },
  { href: '/trips', label: 'Trips', icon: Luggage },
  { href: '/clients', label: 'Clients', icon: UserRound },
  { href: '/insights', label: 'Insights', icon: ChartColumn },
  { href: '/earnings', label: 'Earnings', icon: BadgeDollarSign },
  { href: '/community', label: 'Community', icon: MessagesSquare },
];
const RAIL: NavItem[] = [
  { href: '/assistant', label: 'Assistant', icon: Sparkles },
  { href: '/learn', label: 'Learn', icon: GraduationCap },
  { href: '/application', label: 'Membership', icon: IdCard },
];

/** Advisor portal (session cookie + MFA enforced by the API; this guard only redirects). */
export default function AdvisorLayout({ children }: { children: ReactNode }) {
  const { me } = useRequireRole('advisor');
  const unread = useQuery({
    queryKey: ['unread-messages'],
    queryFn: () => call(api.GET('/v1/trips/messages/unread')),
    enabled: Boolean(me),
    refetchInterval: 30_000,
    retry: false,
  });
  const tabs = TABS.map((t) =>
    t.href === '/trips' && unread.data?.unread ? { ...t, badge: unread.data.unread } : t,
  );
  return (
    <AppShell tabs={tabs} rail={RAIL} accountHref="/application">
      {me ? children : <p className="text-muted">Loading…</p>}
    </AppShell>
  );
}
