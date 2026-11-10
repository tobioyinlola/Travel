'use client';

import { Banknote, ClipboardList, Handshake, LockKeyhole, ShieldCheck, Ticket } from 'lucide-react';
import type { ReactNode } from 'react';
import { AppShell, type NavItem } from '@/components/shell';
import { useRequireRole } from '@/lib/session';

const TABS: NavItem[] = [
  { href: '/admin/applications', label: 'Applications', icon: ClipboardList },
  { href: '/admin/partners', label: 'Partners', icon: Handshake },
  { href: '/admin/moderation', label: 'Moderation', icon: ShieldCheck },
  { href: '/admin/privacy', label: 'Privacy', icon: LockKeyhole },
  { href: '/admin/finance', label: 'Finance', icon: Banknote },
  { href: '/admin/promo-codes', label: 'Promo codes', icon: Ticket },
];

/** Admin console: role-scoped, MFA required (enforced by the API). */
export default function AdminLayout({ children }: { children: ReactNode }) {
  const { me } = useRequireRole('admin');
  return <AppShell tabs={TABS}>{me ? children : <p className="text-muted">Loading…</p>}</AppShell>;
}
