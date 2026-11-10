'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Alert, Button, Field } from '@/components/ui';
import { api, ApiError, call } from '@/lib/api';

type Choice = 'approve' | 'request_changes' | 'decline';

/** FR-ITN-06: approve, ask for changes, or decline, from the same link. */
export function Decision({
  token,
  status,
  ratesExpired,
  advisorName,
  decidedByName,
}: {
  token: string;
  status: string;
  ratesExpired: boolean;
  advisorName: string;
  decidedByName: string | null;
}) {
  const router = useRouter();
  const [choice, setChoice] = useState<Choice>('approve');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (status === 'booking') return null; // checkout takes over once approved
  if (status === 'approved')
    return <ApprovedNotice decidedByName={decidedByName} advisorName={advisorName} />;
  if (status === 'changes_requested')
    return (
      <Alert kind="info">
        Thanks. {advisorName} has your requested changes and will send an updated proposal.
      </Alert>
    );
  if (status === 'declined')
    return <Alert kind="info">You declined this proposal. {advisorName} has been told.</Alert>;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      await call(
        api.POST('/v1/proposal-links/{token}/decision', {
          params: { path: { token } },
          body: {
            decision: choice,
            name: String(f.get('name')).trim(),
            ...(String(f.get('note') ?? '').trim() ? { note: String(f.get('note')).trim() } : {}),
          },
        }),
      );
      router.refresh();
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.problem.title}. ${err.problem.detail ?? ''}`
          : 'Something went wrong',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-4 rounded-[28px] bg-surface p-5">
      <h2 className="text-lg font-normal">Your answer</h2>
      {ratesExpired && (
        <Alert kind="info">
          These prices have expired. You can ask for changes now; {advisorName} will re-check the
          prices before you approve.
        </Alert>
      )}
      {error && <Alert>{error}</Alert>}
      <fieldset className="flex flex-col gap-2">
        <legend className="sr-only">Decision</legend>
        {(
          [
            ['approve', 'Approve this trip'],
            ['request_changes', 'Ask for changes'],
            ['decline', 'Decline'],
          ] as const
        ).map(([v, label]) => (
          <label key={v} className="flex items-center gap-2">
            <input
              type="radio"
              name="choice"
              value={v}
              checked={choice === v}
              onChange={() => setChoice(v)}
              disabled={v === 'approve' && ratesExpired}
            />{' '}
            {label}
          </label>
        ))}
      </fieldset>
      <Field label="Your full name" name="name" autoComplete="name" required minLength={2} />
      {choice !== 'approve' && (
        <div className="flex flex-col gap-1">
          <label htmlFor="note" className="text-sm font-medium">
            {choice === 'decline'
              ? 'Anything you would like to say (optional)'
              : 'What would you like to change?'}
          </label>
          <textarea
            id="note"
            name="note"
            rows={4}
            required={choice === 'request_changes'}
            maxLength={2000}
            className="rounded-[18px] bg-canvas px-4 py-3 outline-none focus:ring-2 focus:ring-accent"
          />
        </div>
      )}
      <Button type="submit" disabled={busy || (choice === 'approve' && ratesExpired)}>
        {choice === 'approve' ? 'Approve' : choice === 'decline' ? 'Decline' : 'Send to my advisor'}
      </Button>
      {choice === 'approve' && (
        <p className="text-xs text-muted">
          Next you add your details and choose how to pay. You will see the amount before anything
          is charged.
        </p>
      )}
    </form>
  );
}

/**
 * Approval is recorded at once, but the booking for checkout is prepared a moment later by the worker. Look
 * again a few times; trips with nothing to book keep the plain message.
 */
function ApprovedNotice({
  decidedByName,
  advisorName,
}: {
  decidedByName: string | null;
  advisorName: string;
}) {
  const router = useRouter();
  const [tries, setTries] = useState(0);
  useEffect(() => {
    if (tries >= 8) return;
    const id = setTimeout(() => {
      setTries(tries + 1);
      router.refresh();
    }, 1500);
    return () => clearTimeout(id);
  }, [tries, router]);
  return (
    <Alert kind="success">
      Approved by {decidedByName}.{' '}
      {tries < 8 ? 'Preparing your booking…' : `${advisorName} will be in touch to book.`}
    </Alert>
  );
}
