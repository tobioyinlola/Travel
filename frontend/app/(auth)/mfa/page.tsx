'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Field } from '@/components/ui';
import { api, ApiError, call } from '@/lib/api';
import { nextPath, useRefreshMe } from '@/lib/session';

export default function MfaChallengePage() {
  const router = useRouter();
  const refresh = useRefreshMe();
  const [useRecovery, setUseRecovery] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const value = String(new FormData(e.currentTarget).get('value')).trim();
    try {
      const me = await call(
        api.POST('/v1/auth/mfa/challenge', {
          body: useRecovery ? { recoveryCode: value } : { code: value },
        }),
      );
      await refresh();
      router.push(nextPath(me));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    }
  }

  return (
    <>
      <h1 className="text-3xl font-normal tracking-tight">Two-step sign-in</h1>
      <form onSubmit={onSubmit} className="mt-6 flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        {useRecovery ? (
          <Field key="rc" label="Recovery code" name="value" autoComplete="off" required />
        ) : (
          <Field
            key="totp"
            label="Code from your authenticator app"
            name="value"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            required
          />
        )}
        <Button type="submit">Continue</Button>
        <button
          type="button"
          className="text-sm text-brand-700 underline"
          onClick={() => setUseRecovery(!useRecovery)}
        >
          {useRecovery ? 'Use the authenticator app instead' : 'Use a recovery code'}
        </button>
      </form>
    </>
  );
}
