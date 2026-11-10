'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { api, call } from './api';

export type Me = Awaited<ReturnType<typeof fetchMe>>;

async function fetchMe() {
  const res = await api.GET('/v1/auth/me');
  if (res.response.status === 401) return null;
  return call(Promise.resolve(res));
}

export function useMe() {
  return useQuery({ queryKey: ['me'], queryFn: fetchMe, staleTime: 10_000 });
}

export function useRefreshMe() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: ['me'] });
}

/** Where a signed-in user should land next. */
export function nextPath(me: NonNullable<Me>): string {
  if (me.next === 'mfa_enroll') return '/mfa/setup';
  if (me.next === 'mfa_challenge') return '/mfa';
  if (me.role === 'advisor') return '/dashboard';
  if (me.role === 'finance') return '/admin/finance';
  if (me.role === 'support') return '/admin/support';
  return '/admin/applications';
}

export type Role = 'advisor' | 'admin' | 'finance' | 'support';

/** Client-side redirect guard. The API enforces every rule; this only keeps people on the right page. */
export function useRequireRole(role: 'advisor' | 'staff') {
  const allowed = (r: string) => (role === 'advisor' ? r === 'advisor' : r !== 'advisor');
  const { data: me, isPending } = useMe();
  const router = useRouter();
  useEffect(() => {
    if (isPending) return;
    if (!me) router.replace('/login');
    else if (me.next) router.replace(nextPath(me));
    else if (!allowed(me.role)) router.replace(nextPath(me));
  }, [me, isPending, role, router]);
  return { me: me && !me.next && allowed(me.role) ? me : null, isPending };
}
