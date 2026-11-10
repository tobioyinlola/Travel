/**
 * Demo mode: the app runs with sample data and no backend, for previews (for example on Vercel).
 * Turned on with NEXT_PUBLIC_DEMO_MODE=1 at build time. With it off, the app talks to the real API.
 */
export const isDemo = process.env.NEXT_PUBLIC_DEMO_MODE === '1';

export type DemoRole = 'advisor' | 'admin' | 'finance' | 'support';
export const DEMO_ROLES: Array<{ role: DemoRole; label: string; email: string; blurb: string }> = [
  {
    role: 'advisor',
    label: 'Travel advisor',
    email: 'sandra@demo.test',
    blurb: 'Clients, trips, bookings, earnings',
  },
  {
    role: 'admin',
    label: 'Admin',
    email: 'admin@demo.test',
    blurb: 'Applications, partners, settings, everything',
  },
  {
    role: 'finance',
    label: 'Finance',
    email: 'finance@demo.test',
    blurb: 'Reconciliation, payouts, reports',
  },
  {
    role: 'support',
    label: 'Support',
    email: 'support@demo.test',
    blurb: 'Stuck bookings, privacy requests',
  },
];

const KEY = 'atp.demo.role';
export function getDemoRole(): DemoRole | null {
  try {
    const v = globalThis.localStorage?.getItem(KEY);
    return v === 'advisor' || v === 'admin' || v === 'finance' || v === 'support' ? v : null;
  } catch {
    return null;
  }
}
export function setDemoRole(role: DemoRole | null): void {
  try {
    if (role) globalThis.localStorage?.setItem(KEY, role);
    else globalThis.localStorage?.removeItem(KEY);
  } catch {
    /* private mode: the demo still works for this page view */
  }
}
export function roleFromEmail(identifier: string): DemoRole {
  const s = identifier.toLowerCase();
  if (s.includes('admin')) return 'admin';
  if (s.includes('finance')) return 'finance';
  if (s.includes('support')) return 'support';
  return 'advisor';
}
