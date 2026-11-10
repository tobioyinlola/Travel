'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Field } from '@/components/ui';
import { api, ApiError, call } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await call(
        api.POST('/v1/auth/password-reset/request', {
          body: { identifier: String(new FormData(e.currentTarget).get('identifier')).trim() },
        }),
      );
      setSent(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1 className="text-3xl font-normal tracking-tight">Reset your password</h1>
      {sent ? (
        <div className="mt-6 flex flex-col gap-4">
          <Alert kind="success">
            If there is an account with that email, we have sent a link to choose a new password. It
            works once and expires in an hour.
          </Alert>
          <Link className="text-sm underline" href="/login">
            Back to sign in
          </Link>
        </div>
      ) : (
        <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
          <p className="text-sm text-muted">
            Enter the email you signed up with. You will still need your authenticator app to sign
            in afterwards.
          </p>
          {error && <Alert>{error}</Alert>}
          <Field label="Email" name="identifier" type="email" autoComplete="email" required />
          <Button type="submit" disabled={busy}>
            {busy ? 'Sending…' : 'Send reset link'}
          </Button>
          <Link className="text-sm underline" href="/login">
            Back to sign in
          </Link>
        </form>
      )}
    </>
  );
}
