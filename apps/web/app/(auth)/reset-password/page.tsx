'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { Alert, Button, Field } from '@/components/ui';
import { api, ApiError, call } from '@/lib/api';

function ResetForm() {
  const token = useSearchParams().get('token') ?? '';
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const password = String(f.get('password'));
    if (password !== String(f.get('confirm'))) {
      setError('The two passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await call(api.POST('/v1/auth/password-reset/confirm', { body: { token, password } }));
      setDone(true);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.problem.title}${err.fieldError('password') ? `: ${err.fieldError('password')}` : '.'} ${err.problem.detail ?? ''}`
          : 'Something went wrong',
      );
    } finally {
      setBusy(false);
    }
  }

  if (!token)
    return (
      <Alert>
        This link is incomplete.{' '}
        <Link className="underline" href="/forgot-password">
          Request a new one
        </Link>
        .
      </Alert>
    );
  if (done)
    return (
      <div className="flex flex-col gap-4">
        <Alert kind="success">Your password is changed and you were signed out everywhere.</Alert>
        <Link className="text-sm underline" href="/login">
          Sign in with your new password
        </Link>
      </div>
    );
  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4">
      {error && <Alert>{error}</Alert>}
      <Field
        label="New password"
        name="password"
        type="password"
        autoComplete="new-password"
        required
        minLength={12}
        hint="At least 12 characters. A few random words work well."
      />
      <Field
        label="Repeat the new password"
        name="confirm"
        type="password"
        autoComplete="new-password"
        required
        minLength={12}
      />
      <Button type="submit" disabled={busy}>
        {busy ? 'Saving…' : 'Set new password'}
      </Button>
    </form>
  );
}

export default function ResetPasswordPage() {
  return (
    <>
      <h1 className="text-3xl font-normal tracking-tight">Choose a new password</h1>
      <div className="mt-6">
        <Suspense fallback={<p className="text-muted">Loading…</p>}>
          <ResetForm />
        </Suspense>
      </div>
    </>
  );
}
