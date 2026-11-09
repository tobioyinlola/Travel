'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { use, useState, type FormEvent } from 'react';
import { ClientForm } from '@/components/client-form';
import { AccessNotice } from '@/components/gate';
import { Alert, Button, Card, Field, StatusBadge } from '@/components/ui';
import { api, ApiError, call, formatMoney } from '@/lib/api';

export default function ClientPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const key = ['client', id];
  const q = useQuery({
    queryKey: key,
    queryFn: () => call(api.GET('/v1/clients/{id}', { params: { path: { id } } })),
    retry: false,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: key });
  const onError = (e: unknown) =>
    setError(e instanceof ApiError ? e.message : 'Something went wrong');

  const archive = useMutation({
    mutationFn: (archived: boolean) =>
      call(
        archived
          ? api.POST('/v1/clients/{id}/archive', { params: { path: { id } } })
          : api.POST('/v1/clients/{id}/restore', { params: { path: { id } } }),
      ),
    onSuccess: refresh,
    onError,
  });
  const removeCompanion = useMutation({
    mutationFn: (companionId: string) =>
      call(
        api.DELETE('/v1/clients/{id}/companions/{companionId}', {
          params: { path: { id, companionId } },
        }),
      ),
    onSuccess: refresh,
    onError,
  });
  const privacy = useMutation({
    mutationFn: (kind: 'export' | 'delete') =>
      call(
        api.POST('/v1/clients/{id}/privacy-requests', {
          params: { path: { id } },
          body: { kind, note: '' },
        }),
      ),
    onSuccess: async (_, kind) => {
      setNotice(
        `${kind === 'export' ? 'Export' : 'Deletion'} request logged. Our team verifies the client's identity and completes it within 30 days.`,
      );
      await refresh();
    },
    onError,
  });

  async function addCompanion(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const f = new FormData(form);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    try {
      await call(
        api.POST('/v1/clients/{id}/companions', {
          params: { path: { id } },
          body: {
            firstName: s('cFirst'),
            lastName: s('cLast'),
            relationship: s('cRel'),
            dateOfBirth: s('cDob') || null,
          },
        }),
      );
      form.reset();
      await refresh();
    } catch (err) {
      onError(err);
    }
  }

  if (q.isPending) return <p className="text-muted">Loading…</p>;
  if (q.isError) return <AccessNotice error={q.error} />;
  const c = q.data;

  return (
    <div className="flex flex-col gap-6">
      <Link href="/clients" className="text-sm text-brand-700 underline">
        All clients
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">
          {c.firstName} {c.lastName}
        </h1>
        {c.status !== 'active' && <StatusBadge status={c.status} />}
        <div className="ml-auto flex gap-2">
          <Button variant="secondary" onClick={() => setEditing(!editing)}>
            {editing ? 'Cancel' : 'Edit'}
          </Button>
          <Button variant="secondary" onClick={() => archive.mutate(c.status === 'active')}>
            {c.status === 'active' ? 'Archive' : 'Restore'}
          </Button>
        </div>
      </div>
      {error && <Alert>{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      {editing ? (
        <Card title="Edit client">
          <ClientForm
            initial={c}
            submitLabel="Save changes"
            onSubmit={async (v) => {
              await call(
                api.PATCH('/v1/clients/{id}', {
                  params: { path: { id } },
                  body: { ...v, version: c.version },
                }),
              );
              setEditing(false);
              await refresh();
            }}
          />
        </Card>
      ) : (
        <div className="grid gap-6 md:grid-cols-2">
          <Card title="Contact">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted">Email</dt>
              <dd>{c.email ?? '—'}</dd>
              <dt className="text-muted">Phone</dt>
              <dd>{c.phone ?? '—'}</dd>
              <dt className="text-muted">Date of birth</dt>
              <dd>{c.dateOfBirth ?? '—'}</dd>
              <dt className="text-muted">Home city</dt>
              <dd>{c.homeCity ?? '—'}</dd>
            </dl>
            {c.notes && <p className="mt-3 whitespace-pre-wrap text-sm">{c.notes}</p>}
          </Card>
          <Card title="Preferences">
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
              <dt className="text-muted">Budget per night</dt>
              <dd>
                {c.preferences.budgetPerNight
                  ? [c.preferences.budgetPerNight.min, c.preferences.budgetPerNight.max]
                      .map((m) => (m ? formatMoney(m) : '…'))
                      .join(' to ')
                  : '—'}
              </dd>
              <dt className="text-muted">Hotel style</dt>
              <dd>{c.preferences.hotelStyles?.join(', ').replace(/_/g, ' ') || '—'}</dd>
              <dt className="text-muted">Dietary</dt>
              <dd>{c.preferences.dietary?.join(', ') || '—'}</dd>
              <dt className="text-muted">Accessibility</dt>
              <dd>{c.preferences.accessibility || '—'}</dd>
              <dt className="text-muted">Pace</dt>
              <dd>{c.preferences.travelPace ?? '—'}</dd>
              <dt className="text-muted">Loyalty</dt>
              <dd>
                {c.preferences.loyalty?.map((l) => `${l.program} ${l.number}`).join('; ') || '—'}
              </dd>
            </dl>
          </Card>
        </div>
      )}

      <Card title="Travelling companions">
        <ul className="mb-4 flex flex-col divide-y divide-gray-100 text-sm">
          {c.companions.map((p) => (
            <li key={p.id} className="flex items-center justify-between py-2">
              <span>
                {p.firstName} {p.lastName}{' '}
                <span className="text-muted">
                  ({p.relationship}
                  {p.dateOfBirth ? `, born ${p.dateOfBirth}` : ''})
                </span>
              </span>
              <button
                className="text-xs text-brand-700 underline"
                onClick={() => removeCompanion.mutate(p.id)}
              >
                Remove
              </button>
            </li>
          ))}
          {c.companions.length === 0 && <li className="py-2 text-muted">None yet</li>}
        </ul>
        <form onSubmit={addCompanion} className="grid gap-3 sm:grid-cols-5 sm:items-end">
          <Field label="First name" name="cFirst" required />
          <Field label="Last name" name="cLast" required />
          <Field label="Relationship" name="cRel" required placeholder="partner, child…" />
          <Field label="Date of birth" name="cDob" type="date" />
          <Button type="submit" variant="secondary">
            Add
          </Button>
        </form>
      </Card>

      <Card title="Trip history">
        {c.trips.length === 0 ? (
          <p className="text-sm text-muted">Trips appear here once you build proposals and book.</p>
        ) : (
          <ul className="text-sm">
            {c.trips.map((t) => (
              <li key={t.tripId}>
                {t.title} · {t.startDate ?? ''} <StatusBadge status={t.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card title="Privacy">
        <p className="text-sm text-muted">
          If this client asks for a copy of their data or for it to be deleted, log the request
          here.
        </p>
        <div className="mt-3 flex flex-wrap gap-3">
          <Button variant="secondary" onClick={() => privacy.mutate('export')}>
            Client asked for their data
          </Button>
          <Button
            variant="danger"
            onClick={() => {
              if (
                confirm("Log a deletion request? Once verified, this client's details are erased.")
              )
                privacy.mutate('delete');
            }}
          >
            Client asked to be deleted
          </Button>
        </div>
        {c.privacyRequests.length > 0 && (
          <ul className="mt-3 text-sm">
            {c.privacyRequests.map((r) => (
              <li key={r.id}>
                {r.kind} request · <StatusBadge status={r.status} /> · due{' '}
                {new Date(r.dueAt).toLocaleDateString()}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
