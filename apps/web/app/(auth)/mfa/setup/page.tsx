'use client';

import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { Alert, Button, Card, Field } from '@/components/ui';
import { api, ApiError, call } from '@/lib/api';
import { nextPath, useMe, useRefreshMe } from '@/lib/session';

type Enrollment = { secret: string; otpauthUri: string; qrDataUrl: string };

/** FR-AUTH-02: authenticator-app MFA, required for advisors and staff. */
export default function MfaSetupPage() {
  const router = useRouter();
  const refresh = useRefreshMe();
  const { data: me } = useMe();
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [recovery, setRecovery] = useState<string[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setError(null);
    try {
      setEnrollment(await call(api.POST('/v1/auth/mfa/enroll')));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    }
  }

  async function confirm(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    try {
      const code = String(new FormData(e.currentTarget).get('code')).trim();
      const res = await call(api.POST('/v1/auth/mfa/enroll/confirm', { body: { code } }));
      setRecovery(res.recoveryCodes);
      await refresh();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong');
    }
  }

  if (recovery) {
    return (
      <>
        <h1 className="text-2xl font-semibold">Save your recovery codes</h1>
        <p className="mt-1 text-muted">
          Each code works once if you lose your phone. They will not be shown again.
        </p>
        <ul className="mt-4 grid grid-cols-2 gap-2 rounded-md border border-gray-200 bg-surface p-4 font-mono text-sm">
          {recovery.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <Button
          className="mt-6"
          onClick={() => router.push(me ? nextPath({ ...me, next: null }) : '/')}
        >
          I have saved them
        </Button>
      </>
    );
  }

  return (
    <>
      <h1 className="text-2xl font-semibold">Set up two-step sign-in</h1>
      <p className="mt-1 text-muted">
        Use an authenticator app such as Google Authenticator, 1Password or Authy.
      </p>
      <div className="mt-6 flex flex-col gap-4">
        {error && <Alert>{error}</Alert>}
        {!enrollment ? (
          <Button onClick={start}>Start</Button>
        ) : (
          <Card>
            <img
              src={enrollment.qrDataUrl}
              alt="QR code to add this account to your authenticator app"
              width={200}
              height={200}
            />
            <p className="mt-3 text-sm text-muted">
              Can&apos;t scan? Enter this key:{' '}
              <code className="break-all font-mono text-ink">{enrollment.secret}</code>
            </p>
            <form onSubmit={confirm} className="mt-4 flex flex-col gap-4">
              <Field
                label="6-digit code from the app"
                name="code"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={6}
                required
              />
              <Button type="submit">Turn on</Button>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}
