'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  LogOut,
  Menu,
  PanelLeftClose,
  PanelLeftOpen,
  UserRound,
  X,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { useMe, useRefreshMe } from '@/lib/session';
import { Avatar, ICON } from './ui';

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
      <svg width="40" height="40" viewBox="0 0 40 40" aria-hidden className="shrink-0">
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
      {withName && <span className="text-lg font-medium tracking-tight">Advisor</span>}
    </Link>
  );
}

function isActive(pathname: string, item: NavItem): boolean {
  return [item.href, ...(item.match ?? [])].some(
    (p) => pathname === p || pathname.startsWith(`${p}/`),
  );
}

/** Account button with a small menu. In the sidebar it opens upwards. */
function AccountMenu({
  accountHref,
  compact = false,
  up = false,
}: {
  accountHref?: string | undefined;
  compact?: boolean;
  up?: boolean;
}) {
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
        className={`flex h-14 items-center gap-3 rounded-full bg-surface p-1.5 text-left ${compact ? 'w-14 justify-center' : 'w-full pr-4'}`}
      >
        {/* Spoken name = visible text + "account menu" (WCAG 2.5.3 label in name). */}
        <Avatar name={name} decorative={false} />{' '}
        <span className={compact ? 'sr-only' : 'min-w-0 flex-1 truncate text-sm'}>{name}</span>
        <span className="sr-only">, account menu</span>
      </button>
      {open && (
        <div
          role="menu"
          className={`absolute z-40 w-60 rounded-[20px] bg-surface p-2 shadow-[0_12px_40px_rgba(0,0,0,0.10)] ${up ? 'bottom-full left-0 mb-2' : 'right-0 mt-2'}`}
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

/** One sidebar entry: pill with icon and label; icon-only when the sidebar is collapsed. */
function SideLink({
  item,
  active,
  compact,
  onNavigate,
}: {
  item: NavItem;
  active: boolean;
  compact: boolean;
  onNavigate?: (() => void) | undefined;
}) {
  return (
    <Link
      href={item.href}
      onClick={onNavigate}
      aria-current={active ? 'page' : undefined}
      aria-label={compact ? item.label : undefined}
      title={compact ? item.label : undefined}
      className={`flex h-12 items-center gap-3 rounded-full text-[15px] transition-colors ${compact ? 'w-12 justify-center' : 'px-4'} ${
        active ? 'bg-ink text-white' : 'text-ink hover:bg-surface'
      }`}
    >
      <item.icon {...ICON} className="shrink-0" aria-hidden />
      {!compact && <span className="truncate">{item.label}</span>}
    </Link>
  );
}

const COLLAPSE_KEY = 'atp.sidebar.collapsed';

function SidebarBody({
  tabs,
  rail,
  railBottom,
  accountHref,
  compact,
  onNavigate,
  onToggle,
}: {
  tabs: NavItem[];
  rail: NavItem[];
  railBottom: NavItem[];
  accountHref?: string | undefined;
  compact: boolean;
  onNavigate?: () => void;
  onToggle?: () => void;
}) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col gap-6">
      <div
        className={`flex items-center ${compact ? 'justify-center' : 'justify-between gap-2 pl-2'}`}
      >
        <Logo withName={!compact} />
      </div>
      <nav aria-label="Primary" className={`flex flex-col gap-1 ${compact ? 'items-center' : ''}`}>
        {tabs.map((t) => (
          <SideLink
            key={t.href}
            item={t}
            active={isActive(pathname, t)}
            compact={compact}
            onNavigate={onNavigate}
          />
        ))}
      </nav>
      {rail.length > 0 && (
        <nav aria-label="Tools" className={`flex flex-col gap-1 ${compact ? 'items-center' : ''}`}>
          {!compact && <p className="px-4 pb-1 text-xs text-muted">Tools</p>}
          {compact && <span className="mx-auto mb-1 h-px w-8 bg-line" aria-hidden />}
          {rail.map((t) => (
            <SideLink
              key={t.href}
              item={t}
              active={isActive(pathname, t)}
              compact={compact}
              onNavigate={onNavigate}
            />
          ))}
        </nav>
      )}
      <div className={`mt-auto flex flex-col gap-2 ${compact ? 'items-center' : ''}`}>
        {railBottom.map((t) => (
          <SideLink
            key={t.href}
            item={t}
            active={isActive(pathname, t)}
            compact={compact}
            onNavigate={onNavigate}
          />
        ))}
        <AccountMenu accountHref={accountHref} compact={compact} up />
        {onToggle && (
          <button
            onClick={onToggle}
            aria-label={compact ? 'Expand sidebar' : 'Collapse sidebar'}
            title={compact ? 'Expand sidebar' : 'Collapse sidebar'}
            className={`flex h-10 items-center gap-3 rounded-full text-sm text-muted hover:bg-surface hover:text-ink ${compact ? 'w-10 justify-center' : 'px-4'}`}
          >
            {compact ? (
              <PanelLeftOpen {...ICON} aria-hidden />
            ) : (
              <PanelLeftClose {...ICON} aria-hidden />
            )}
            {!compact && 'Collapse'}
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * App frame: navigation lives in a left sidebar (sections, then tools, account at the bottom). It collapses
 * to an icon rail, as in the reference, and the choice is remembered on this device. On phones it becomes a
 * drawer opened from a slim top bar.
 */
export function AppShell({
  tabs,
  rail = [],
  railBottom = [],
  accountHref,
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
  const [compact, setCompact] = useState(false);
  const [drawer, setDrawer] = useState(false);

  useEffect(() => {
    try {
      setCompact(localStorage.getItem(COLLAPSE_KEY) === '1');
    } catch {
      /* storage unavailable: default to expanded */
    }
  }, []);
  useEffect(() => setDrawer(false), [pathname]);
  useEffect(() => {
    if (!drawer) return;
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setDrawer(false);
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [drawer]);

  function toggle() {
    const next = !compact;
    setCompact(next);
    try {
      localStorage.setItem(COLLAPSE_KEY, next ? '1' : '0');
    } catch {
      /* ignore */
    }
  }

  const current = [...tabs, ...rail, ...railBottom].find((t) => isActive(pathname, t));

  return (
    <div className="min-h-screen md:flex">
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-surface focus:px-4 focus:py-2"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside
        aria-label="Sidebar"
        className={`sticky top-0 hidden h-screen shrink-0 border-r border-line/70 py-5 transition-[width] duration-200 md:block ${compact ? 'w-[88px] px-4' : 'w-64 px-4'}`}
      >
        <SidebarBody
          tabs={tabs}
          rail={rail}
          railBottom={railBottom}
          accountHref={accountHref}
          compact={compact}
          onToggle={toggle}
        />
      </aside>

      {/* Phone top bar */}
      <header className="sticky top-0 z-30 flex items-center gap-3 bg-canvas/90 px-4 py-3 backdrop-blur md:hidden">
        <button
          onClick={() => setDrawer(true)}
          aria-label="Open menu"
          aria-expanded={drawer}
          className="flex h-12 w-12 items-center justify-center rounded-full bg-surface"
        >
          <Menu {...ICON} aria-hidden />
        </button>
        <Logo withName={false} />
        <span className="truncate text-sm text-muted">{current?.label}</span>
      </header>

      {/* Phone drawer */}
      {drawer && (
        <div
          className="fixed inset-0 z-40 md:hidden"
          role="dialog"
          aria-modal="true"
          aria-label="Menu"
        >
          <button
            className="absolute inset-0 bg-ink/30"
            aria-label="Close menu"
            onClick={() => setDrawer(false)}
          />
          <div className="absolute inset-y-0 left-0 w-72 bg-canvas p-4 shadow-[0_0_40px_rgba(0,0,0,0.15)]">
            <button
              onClick={() => setDrawer(false)}
              aria-label="Close menu"
              className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-surface"
            >
              <X {...ICON} aria-hidden />
            </button>
            <SidebarBody
              tabs={tabs}
              rail={rail}
              railBottom={railBottom}
              accountHref={accountHref}
              compact={false}
              onNavigate={() => setDrawer(false)}
            />
          </div>
        </div>
      )}

      <main id="main" className="min-w-0 flex-1 px-4 pb-12 pt-4 sm:px-6 md:pt-8 lg:px-10">
        <div className="mx-auto max-w-[1400px]">{children}</div>
      </main>
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
