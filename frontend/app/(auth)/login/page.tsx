'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { DemoRoles } from '@/components/demo-roles';
import { Alert, Button, Field } from '@/components/ui';
import { api, ApiError, call } from '@/lib/api';
import { nextPath, useRefreshMe } from '@/lib/session';

export default function LoginPage() {
  const router = useRouter();
  const refresh = useRefreshMe();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const me = await call(
        api.POST('/v1/auth/login', {
          body: { identifier: String(f.get('identifier')), password: String(f.get('password')) },
        }),
      );
      await refresh();
      router.push(nextPath(me));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <DemoRoles />
      <h1 className="text-3xl font-normal tracking-tight">Sign in</h1>
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        <Field label="Email or phone" name="identifier" autoComplete="username" required />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <Button type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </Button>
        <Link className="text-sm underline" href="/forgot-password">
          Forgot your password?
        </Link>
      </form>
      <p className="mt-6 text-sm text-muted">
        New here?{' '}
        <Link className="text-brand-700 underline" href="/signup">
          Become an advisor
        </Link>
      </p>
    </>
  );
}
