'use client';

import {
  Banknote,
  LifeBuoy,
  ChartColumn,
  ClipboardList,
  SlidersHorizontal,
  Users,
  Handshake,
  LockKeyhole,
  ShieldCheck,
  Ticket,
} from 'lucide-react';
import type { ReactNode } from 'react';
import { AppShell, type NavItem } from '@/components/shell';
import { useRequireRole } from '@/lib/session';

type StaffTab = NavItem & { roles: string[] };
const ALL_TABS: StaffTab[] = [
  { href: '/admin/applications', label: 'Applications', icon: ClipboardList, roles: ['admin'] },
  { href: '/admin/partners', label: 'Partners', icon: Handshake, roles: ['admin'] },
  { href: '/admin/moderation', label: 'Moderation', icon: ShieldCheck, roles: ['admin'] },
  { href: '/admin/privacy', label: 'Privacy', icon: LockKeyhole, roles: ['admin', 'support'] },
  { href: '/admin/support', label: 'Stuck bookings', icon: LifeBuoy, roles: ['admin', 'support'] },
  { href: '/admin/advisors', label: 'Advisors', icon: Users, roles: ['admin'] },
  { href: '/admin/finance', label: 'Finance', icon: Banknote, roles: ['admin', 'finance'] },
  { href: '/admin/reports', label: 'Reports', icon: ChartColumn, roles: ['admin', 'finance'] },
  { href: '/admin/settings', label: 'Settings', icon: SlidersHorizontal, roles: ['admin'] },
  { href: '/admin/promo-codes', label: 'Promo codes', icon: Ticket, roles: ['admin'] },
];

/** Admin console: role-scoped, MFA required (enforced by the API). */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const { me } = useRequireRole('staff');
  const tabs: NavItem[] = ALL_TABS.filter((t) => !me || t.roles.includes(me.role));
  return <AppShell tabs={tabs}>{me ? children : <p className="text-muted">Loading…</p>}</AppShell>;
}
