'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { use, useState } from 'react';
import { Alert, Button, Card, StatusBadge } from '@/components/ui';
import { api, ApiError, call, formatMoney } from '@/lib/api';

interface ApplicationView {
  id: string;
  status: string;
  legalName: string;
  country: string;
  taxResidency: string;
  experience: string;
  niche: string;
  submittedAt: string;
  acceptedAt: string | null;
  infoRequestNote: string | null;
  address: { line1: string; line2?: string; city: string; region?: string; postalCode?: string };
  kyc: { status: string; checkedAt: string | null };
  agreement: {
    status: string;
    version: string | null;
    signedAt: string | null;
    documentRef: string | null;
  };
}

type Decision = 'accept' | 'reject' | 'request_info';

export default function ApplicationDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['admin-application', id],
    queryFn: () => call(api.GET('/v1/admin/applications/{id}', { params: { path: { id } } })),
  });
  const decide = useMutation({
    mutationFn: (decision: Decision) =>
      call(
        api.POST('/v1/admin/applications/{id}/decision', {
          params: { path: { id } },
          body: { decision, ...(note.trim() ? { note: note.trim() } : {}) },
        }),
      ),
    onSuccess: () => {
      setNote('');
      return qc.invalidateQueries({ queryKey: ['admin-application', id] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Something went wrong'),
  });

  if (q.isPending) return <p className="text-muted">Loading…</p>;
  if (q.isError || !q.data) return <Alert>Could not load this application.</Alert>;
  const app = q.data.application as ApplicationView;
  const m = q.data.membership;
  const canAccept = app.status === 'under_review' && !app.acceptedAt;
  const canDecide = app.status === 'under_review' || app.status === 'applied';

  return (
    <div className="flex flex-col gap-6">
      <Link href="/admin/applications" className="text-sm text-brand-700 underline">
        Back to applications
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-3xl font-normal tracking-tight">{app.legalName}</h1>
        <StatusBadge status={app.status} />
        {app.acceptedAt && app.status === 'under_review' && (
          <span className="text-sm text-muted">Accepted, waiting for membership payment</span>
        )}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card title="Application">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Country</dt>
            <dd>{app.country}</dd>
            <dt className="text-muted">Tax residency</dt>
            <dd>{app.taxResidency}</dd>
            <dt className="text-muted">Address</dt>
            <dd>
              {[
                app.address.line1,
                app.address.line2,
                app.address.city,
                app.address.region,
                app.address.postalCode,
              ]
                .filter(Boolean)
                .join(', ')}
            </dd>
            <dt className="text-muted">Experience</dt>
            <dd>{app.experience}</dd>
            <dt className="text-muted">Niche</dt>
            <dd>{app.niche}</dd>
            <dt className="text-muted">Submitted</dt>
            <dd>{new Date(app.submittedAt).toLocaleString()}</dd>
          </dl>
        </Card>
        <Card title="Checks">
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted">Identity (KYC)</dt>
            <dd>
              <StatusBadge status={app.kyc.status} />
            </dd>
            <dt className="text-muted">Agreement</dt>
            <dd>
              <StatusBadge status={app.agreement.status} />{' '}
              {app.agreement.version && (
                <span className="text-muted">v{app.agreement.version}</span>
              )}
            </dd>
            {app.agreement.documentRef && (
              <>
                <dt className="text-muted">Signed copy</dt>
                <dd className="break-all font-mono text-xs">{app.agreement.documentRef}</dd>
              </>
            )}
            <dt className="text-muted">Membership</dt>
            <dd>
              {m ? (
                <>
                  <StatusBadge status={m.status} /> {m.plan.name}, {formatMoney(m.quote.total)}
                </>
              ) : (
                'No plan chosen yet'
              )}
            </dd>
          </dl>
        </Card>
      </div>

      {canDecide && (
        <Card title="Decision">
          {error && (
            <div className="mb-3">
              <Alert>{error}</Alert>
            </div>
          )}
          <label htmlFor="note" className="text-sm font-medium">
            Note to applicant (required to request information)
          </label>
          <textarea
            id="note"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={2000}
            className="mt-1.5 w-full rounded-[18px] bg-canvas px-4 py-3 outline-none focus:ring-2 focus:ring-accent"
          />
          <div className="mt-3 flex flex-wrap gap-3">
            <Button
              onClick={() => decide.mutate('accept')}
              disabled={!canAccept || decide.isPending}
            >
              Accept
            </Button>
            <Button
              variant="secondary"
              onClick={() => decide.mutate('request_info')}
              disabled={app.status !== 'under_review' || decide.isPending}
            >
              Request information
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (confirm('Reject this application? This cannot be undone.'))
                  decide.mutate('reject');
              }}
              disabled={decide.isPending}
            >
              Reject
            </Button>
          </div>
          {!canAccept && app.status === 'applied' && (
            <p className="mt-2 text-sm text-muted">
              Accepting needs a passed identity check and a signed agreement.
            </p>
          )}
        </Card>
      )}

      <Card title="History">
        <ol className="flex flex-col gap-2 text-sm">
          {q.data.history.map((h) => (
            <li key={h.id} className="flex flex-wrap gap-x-3">
              <time className="text-muted" dateTime={h.occurredAt}>
                {new Date(h.occurredAt).toLocaleString()}
              </time>
              <span className="font-medium">
                {h.action.replace(/^advisor\./, '').replace(/_/g, ' ')}
              </span>
              <span className="text-muted">by {h.actorType}</span>
            </li>
          ))}
        </ol>
      </Card>
    </div>
  );
}
