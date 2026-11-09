'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LogOut, UserRound, type LucideIcon } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useMe, useRefreshMe } from '@/lib/session';
import { Avatar, ICON, IconLink } from './ui';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Also active for these path prefixes. */
  match?: string[];
}

/** Our mark: a route arc between two stops. Original artwork, not the reference's logo. */
export function Logo({ withName = true }: { withName?: boolean }) {
  return (
    <Link
      href="/"
      className="inline-flex items-center gap-3"
      aria-label="Advisor Travel Platform home"
    >
      <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden>
        <rect width="40" height="40" rx="14" fill="#333333" />
        <path
          d="M11 27c3-9 9-14 18-14"
          fill="none"
          stroke="#ffffff"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeDasharray="0.1 4.6"
        />
        <circle cx="11" cy="27" r="3" fill="#ffffff" />
        <circle cx="29" cy="13" r="3.4" fill="#1E8BFF" />
      </svg>
      {withName && (
        <span className="hidden text-lg font-medium tracking-tight lg:inline">Advisor</span>
      )}
    </Link>
  );
}

function isActive(pathname: string, item: NavItem): boolean {
  return [item.href, ...(item.match ?? [])].some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

function AccountMenu({ accountHref }: { accountHref?: string | undefined }) {
  const { data: me } = useMe();
  const refresh = useRefreshMe();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, []);

  if (!me) return null;
  const name = me.displayName ?? me.email ?? me.phone ?? 'Account';

  async function signOut() {
    await api.POST('/v1/auth/logout');
    await refresh();
    router.push('/login');
  }

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="flex h-12 items-center gap-2 rounded-full bg-surface p-1 pr-4"
      >
        {/* Spoken name = visible text + "account menu" (WCAG 2.5.3 label in name). */}
        <Avatar name={name} decorative={false} />{' '}
        <span className="sr-only max-w-40 truncate text-sm sm:not-sr-only sm:inline">{name}</span>
        <span className="sr-only">, account menu</span>
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-2 w-60 rounded-[20px] bg-surface p-2 shadow-[0_12px_40px_rgba(0,0,0,0.08)]"
        >
          <p className="truncate px-3 py-2 text-xs text-muted">{me.email ?? me.phone}</p>
          {accountHref && (
            <Link
              role="menuitem"
              href={accountHref}
              onClick={() => setOpen(false)}
              className="flex items-center gap-3 rounded-[14px] px-3 py-2.5 text-sm hover:bg-canvas"
            >
              <UserRound {...ICON} aria-hidden /> Account
            </Link>
          )}
          <button
            role="menuitem"
            onClick={signOut}
            className="flex w-full items-center gap-3 rounded-[14px] px-3 py-2.5 text-left text-sm hover:bg-canvas"
          >
            <LogOut {...ICON} aria-hidden /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * App frame from the reference: logo, pill tabs across the top, a slim rail of round icon buttons on the left,
 * account on the right. The rail hides on small screens; tabs scroll horizontally.
 */
export function AppShell({
  tabs,
  rail = [],
  railBottom = [],
  accountHref,
  actions,
  children,
}: {
  tabs: NavItem[];
  rail?: NavItem[];
  railBottom?: NavItem[];
  accountHref?: string;
  actions?: ReactNode;
  children: ReactNode;
}) {
  const pathname = usePathname();
  return (
    <div className="min-h-screen px-4 py-5 sm:px-6 lg:px-8">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-surface focus:px-4 focus:py-2"
      >
        Skip to content
      </a>
      <header className="flex items-center gap-3">
        <Logo />
        <nav
          aria-label="Primary"
          className="scrollbar-none ml-1 flex min-w-0 flex-1 gap-2 overflow-x-auto lg:ml-6"
        >
          {tabs.map((t) => {
            const active = isActive(pathname, t);
            return (
              <Link
                key={t.href}
                href={t.href}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex h-12 shrink-0 items-center gap-2 rounded-full px-5 text-sm font-medium transition-colors ${
                  active ? 'bg-ink text-white' : 'bg-surface text-ink hover:bg-white/70'
                }`}
              >
                <t.icon {...ICON} size={18} aria-hidden />
                {t.label}
              </Link>
            );
          })}
        </nav>
        <div className="flex items-center gap-2">
          {actions}
          <AccountMenu accountHref={accountHref} />
        </div>
      </header>
      <div className="mt-6 flex gap-6">
        {(rail.length > 0 || railBottom.length > 0) && (
          <aside
            aria-label="Shortcuts"
            className="sticky top-6 hidden h-[calc(100vh-7rem)] flex-col justify-between md:flex"
          >
            <div className="flex flex-col gap-3">
              {rail.map((r) => (
                <IconLink
                  key={r.href}
                  href={r.href}
                  icon={r.icon}
                  label={r.label}
                  active={isActive(pathname, r)}
                />
              ))}
            </div>
            <div className="flex flex-col gap-3">
              {railBottom.map((r) => (
                <IconLink
                  key={r.href}
                  href={r.href}
                  icon={r.icon}
                  label={r.label}
                  active={isActive(pathname, r)}
                />
              ))}
            </div>
          </aside>
        )}
        <main id="main" className="min-w-0 flex-1 pb-12">
          {children}
        </main>
      </div>
    </div>
  );
}

/** Centred card layout for sign-up, sign-in and MFA. */
export function AuthFrame({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col px-4 py-6 sm:px-8">
      <header>
        <Logo />
      </header>
      <main id="main" className="flex flex-1 items-center justify-center py-10">
        <div className="w-full max-w-md rounded-[var(--radius-card)] bg-surface p-8">
          {children}
        </div>
      </main>
    </div>
  );
}

/** Kept for pages outside the app frame (home). */
export function Shell({ children }: { area?: string; children: ReactNode; nav?: unknown }) {
  return (
    <div className="min-h-screen px-4 py-5 sm:px-8">
      <header className="flex items-center justify-between">
        <Logo />
      </header>
      <main id="main" className="mx-auto max-w-6xl py-10">
        {children}
      </main>
    </div>
  );
}
