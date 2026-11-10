'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Field, Segmented } from '@/components/ui';
import { api, ApiError, call } from '@/lib/api';

export default function SignupPage() {
  const router = useRouter();
  const [mode, setMode] = useState<'email' | 'phone'>('email');
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    setError(null);
    try {
      const body = {
        password: String(f.get('password')),
        displayName: String(f.get('displayName')) || undefined,
        ...(mode === 'email'
          ? { email: String(f.get('email')) }
          : { phone: String(f.get('phone')) }),
      };
      const res = await call(api.POST('/v1/auth/register', { body }));
      router.push(`/verify?userId=${res.userId}&channel=${res.channel}`);
    } catch (err) {
      setError(err instanceof ApiError ? err : null);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="text-3xl font-normal tracking-tight">Become an advisor</h1>
      <p className="mt-1 text-muted">
        Create your account. You will verify it with a one-time code.
      </p>
      <div className="mt-6">
        <Segmented
          label="Sign up with"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'email', label: 'Email' },
            { value: 'phone', label: 'Phone' },
          ]}
        />
      </div>
      <form onSubmit={onSubmit} className="mt-4 flex flex-col gap-4" noValidate>
        {error && <Alert>{error.message}</Alert>}
        <Field label="Your name" name="displayName" autoComplete="name" />
        {mode === 'email' ? (
          <Field
            label="Email"
            name="email"
            type="email"
            autoComplete="email"
            required
            error={error?.fieldError('email')}
          />
        ) : (
          <Field
            label="Phone"
            name="phone"
            type="tel"
            autoComplete="tel"
            required
            placeholder="+2348012345678"
            hint="International format"
            error={error?.fieldError('phone')}
          />
        )}
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={12}
          hint="At least 12 characters"
          error={error?.fieldError('password')}
        />
        <Button type="submit" disabled={busy}>
          {busy ? 'Creating account…' : 'Create account'}
        </Button>
      </form>
      <p className="mt-6 text-sm text-muted">
        Already have an account?{' '}
        <Link className="text-brand-700 underline" href="/login">
          Sign in
        </Link>
      </p>
    </>
  );
}
