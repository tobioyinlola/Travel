'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { Alert, Button, Field } from '@/components/ui';
import { api, ApiError, call } from '@/lib/api';
import { nextPath, useRefreshMe } from '@/lib/session';

function Verify() {
  const params = useSearchParams();
  const router = useRouter();
  const refresh = useRefreshMe();
  const userId = params.get('userId') ?? '';
  const channel = params.get('channel') === 'sms' ? 'text message' : 'email';
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const code = String(new FormData(e.currentTarget).get('code')).trim();
    try {
      const me = await call(api.POST('/v1/auth/verify', { body: { userId, code } }));
      await refresh();
      router.push(nextPath(me));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    }
  }

  async function resend() {
    setError(null);
    try {
      await call(api.POST('/v1/auth/verify/resend', { body: { userId } }));
      setNotice('A new code is on its way.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    }
  }

  return (
    <>
      <h1 className="text-3xl font-normal tracking-tight">Check your {channel}</h1>
      <p className="mt-1 text-muted">
        Enter the 6-digit code we sent you. It expires in 10 minutes.
      </p>
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        {notice && <Alert kind="success">{notice}</Alert>}
        <Field
          label="Code"
          name="code"
          inputMode="numeric"
          autoComplete="one-time-code"
          pattern="\d{6}"
          maxLength={6}
          required
        />
        <Button type="submit">Verify</Button>
        <Button type="button" variant="secondary" onClick={resend}>
          Send a new code
        </Button>
      </form>
    </>
  );
}

export default function VerifyPage() {
  return (
    <Suspense>
      <Verify />
    </Suspense>
  );
}
