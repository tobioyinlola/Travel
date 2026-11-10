'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Accessibility,
  Archive,
  ArchiveRestore,
  BedDouble,
  ChevronLeft,
  Gauge,
  Luggage,
  Mail,
  Pencil,
  Phone,
  Plus,
  Salad,
  Star,
  Trash2,
  Wallet,
  X,
} from 'lucide-react';
import Link from 'next/link';
import { use, useState, type FormEvent } from 'react';
import { ClientForm } from '@/components/client-form';
import { AccessNotice } from '@/components/gate';
import {
  Alert,
  Avatar,
  Button,
  ButtonLink,
  Card,
  Field,
  Flag,
  ICON,
  IconButton,
  ListRow,
  StatusBadge,
} from '@/components/ui';
import { api, ApiError, call, formatMoney } from '@/lib/api';

const shortDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });

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
  const trips = useQuery({
    queryKey: ['trips', { clientId: id }],
    queryFn: () => call(api.GET('/v1/trips', { params: { query: { clientId: id } } })),
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
  const p = c.preferences;
  const name = `${c.firstName} ${c.lastName}`;
  const budget = p.budgetPerNight
    ? [p.budgetPerNight.min, p.budgetPerNight.max]
        .map((m) => (m ? formatMoney(m) : '…'))
        .join(' – ') + ' per night'
    : 'Not set';

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-4 rounded-[var(--radius-card)] bg-surface p-4 pr-6">
        <Link
          href="/clients"
          aria-label="Back to clients"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-canvas hover:bg-line"
        >
          <ChevronLeft {...ICON} aria-hidden />
        </Link>
        <Avatar name={name} size="lg" />
        <div>
          <h1 className="text-2xl font-normal">{name}</h1>
          <p className="text-xs text-muted">
            Client{c.homeCity ? ` · ${c.homeCity}` : ''} · added{' '}
            {shortDate(c.createdAt.slice(0, 10))}
          </p>
        </div>
        {c.status !== 'active' && <StatusBadge status={c.status} />}
        <div className="ml-auto flex flex-wrap gap-2">
          <ButtonLink href={`/trips/new?clientId=${c.id}`} icon={Plus}>
            New trip
          </ButtonLink>
          <IconButton
            icon={Pencil}
            label={editing ? 'Stop editing' : 'Edit client'}
            active={editing}
            onClick={() => setEditing(!editing)}
            className="ring-1 ring-line"
          />
          <IconButton
            icon={c.status === 'active' ? Archive : ArchiveRestore}
            label={c.status === 'active' ? 'Archive client' : 'Restore client'}
            onClick={() => archive.mutate(c.status === 'active')}
            className="ring-1 ring-line"
          />
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
        <>
          <section aria-labelledby="trips-h">
            <h2 id="trips-h" className="mb-3 mt-2 text-2xl font-light text-muted">
              Trips history
            </h2>
            {trips.data && trips.data.length > 0 ? (
              <ul className="flex flex-col gap-2">
                {trips.data.map((t) => (
                  <li key={t.id}>
                    <Link
                      href={`/trips/${t.id}`}
                      className="grid grid-cols-[auto_1fr] items-center gap-4 rounded-[22px] bg-surface p-2.5 pr-6 hover:ring-1 hover:ring-line sm:grid-cols-[auto_1.6fr_1fr_1fr_1fr]"
                    >
                      <span className="flex h-16 w-16 items-center justify-center rounded-[16px] bg-canvas text-2xl">
                        {t.destination ? (
                          <Flag code={t.destination.countryCode} />
                        ) : (
                          <Luggage {...ICON} aria-hidden />
                        )}
                      </span>
                      <span>
                        <span className="block text-lg">{t.title}</span>
                        <span className="block text-sm text-muted">
                          {shortDate(t.startDate)} – {shortDate(t.endDate)}
                        </span>
                      </span>
                      <span className="hidden sm:block">
                        <span className="block text-xs text-muted">Total</span>
                        <span className="text-lg">{t.itemCount ? formatMoney(t.total) : '—'}</span>
                      </span>
                      <span className="hidden sm:block">
                        <span className="block text-xs text-muted">Status</span>
                        <StatusBadge status={t.status} />
                      </span>
                      <span className="hidden sm:block">
                        <span className="block text-xs text-muted">Destination</span>
                        <span className="text-lg">{t.destination?.city ?? '—'}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-[22px] bg-surface px-5 py-6 text-sm text-muted">
                No trips yet.{' '}
                <Link className="text-brand-600 underline" href={`/trips/new?clientId=${c.id}`}>
                  Plan one
                </Link>
                .
              </p>
            )}
          </section>

          <div className="grid gap-4 md:grid-cols-2">
            <Card title="Contact" className="flex flex-col">
              <p className="text-2xl font-light">{name}</p>
              <p className="text-sm text-muted">
                {c.email ?? 'No email'}
                {c.phone ? ` · ${c.phone}` : ''}
              </p>
              <div className="mt-auto flex justify-end gap-2 pt-6">
                {c.phone && (
                  <a
                    href={`tel:${c.phone}`}
                    aria-label={`Call ${name}`}
                    className="flex h-14 w-14 items-center justify-center rounded-full bg-canvas hover:bg-line"
                  >
                    <Phone {...ICON} aria-hidden />
                  </a>
                )}
                {c.email && (
                  <a
                    href={`mailto:${c.email}`}
                    aria-label={`Email ${name}`}
                    className="flex h-14 w-14 items-center justify-center rounded-full bg-canvas hover:bg-line"
                  >
                    <Mail {...ICON} aria-hidden />
                  </a>
                )}
              </div>
            </Card>
            <Card title="Notes">
              <p className="whitespace-pre-wrap text-sm">
                {c.notes || <span className="text-muted">No notes yet.</span>}
              </p>
            </Card>
          </div>

          <Card title="Preferences">
            <ul className="grid gap-2 md:grid-cols-2">
              {[
                { icon: Wallet, title: 'Budget', subtitle: budget },
                {
                  icon: BedDouble,
                  title: 'Hotel style',
                  subtitle: p.hotelStyles?.join(', ').replace(/_/g, ' ') || 'Not set',
                },
                { icon: Salad, title: 'Dietary needs', subtitle: p.dietary?.join(', ') || 'None' },
                {
                  icon: Accessibility,
                  title: 'Accessibility',
                  subtitle: p.accessibility || 'None',
                },
                { icon: Gauge, title: 'Travel pace', subtitle: p.travelPace ?? 'Not set' },
                {
                  icon: Star,
                  title: 'Loyalty',
                  subtitle: p.loyalty?.map((l) => `${l.program} ${l.number}`).join('; ') || 'None',
                },
              ].map((r) => (
                <li key={r.title}>
                  <ListRow tone="canvas" icon={r.icon} title={r.title} subtitle={r.subtitle} />
                </li>
              ))}
            </ul>
          </Card>
        </>
      )}

      <Card title="Travelling companions">
        <ul className="mb-4 flex flex-col gap-2">
          {c.companions.map((m) => (
            <li key={m.id}>
              <ListRow
                tone="canvas"
                leading={<Avatar name={`${m.firstName} ${m.lastName}`} />}
                title={`${m.firstName} ${m.lastName}`}
                subtitle={`${m.relationship}${m.dateOfBirth ? ` · born ${m.dateOfBirth}` : ''}`}
                trailing={
                  <IconButton
                    icon={X}
                    label={`Remove ${m.firstName}`}
                    size="sm"
                    className="bg-canvas"
                    onClick={() => removeCompanion.mutate(m.id)}
                  />
                }
              />
            </li>
          ))}
          {c.companions.length === 0 && <li className="text-sm text-muted">None yet</li>}
        </ul>
        <form
          onSubmit={addCompanion}
          className="grid gap-3 sm:grid-cols-[1fr_1fr_1fr_1fr_auto] sm:items-end"
        >
          <Field label="First name" name="cFirst" required />
          <Field label="Last name" name="cLast" required />
          <Field label="Relationship" name="cRel" required placeholder="partner, child…" />
          <Field label="Date of birth" name="cDob" type="date" />
          <Button type="submit" variant="dark" icon={Plus}>
            Add
          </Button>
        </form>
      </Card>

      <Card title="Privacy">
        <p className="text-sm text-muted">
          If this client asks for a copy of their data or for it to be deleted, log the request
          here. Our team verifies the requester first.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => privacy.mutate('export')}>
            Client asked for their data
          </Button>
          <Button
            variant="danger"
            icon={Trash2}
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
          <ul className="mt-4 flex flex-col gap-2 text-sm">
            {c.privacyRequests.map((r) => (
              <li
                key={r.id}
                className="flex items-center justify-between rounded-[14px] bg-canvas px-4 py-2"
              >
                <span>
                  {r.kind === 'export' ? 'Data export' : 'Deletion'} · due{' '}
                  {shortDate(r.dueAt.slice(0, 10))}
                </span>
                <StatusBadge status={r.status} />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
