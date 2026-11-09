'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Fragment, use, useState, type FormEvent } from 'react';
import { AccessNotice } from '@/components/gate';
import { HotelSearch } from '@/components/hotel-search';
import { Alert, Button, Card, Field, Select, StatusBadge } from '@/components/ui';
import { api, ApiError, call, formatMoney, toMinor } from '@/lib/api';

function days(start: string, end: string): string[] {
  const out: string[] = [];
  for (
    let d = Date.parse(`${start}T00:00:00Z`);
    d <= Date.parse(`${end}T00:00:00Z`);
    d += 86_400_000
  )
    out.push(new Date(d).toISOString().slice(0, 10));
  return out;
}

const longDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });

export default function TripPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const key = ['trip', id];
  const q = useQuery({
    queryKey: key,
    queryFn: () => call(api.GET('/v1/trips/{id}', { params: { path: { id } } })),
    retry: false,
  });
  const setTrip = (data: unknown) => qc.setQueryData(key, data);
  const onError = (e: unknown) =>
    setError(
      e instanceof ApiError
        ? `${e.problem.title}. ${e.problem.detail ?? ''}`
        : 'Something went wrong',
    );

  const remove = useMutation({
    mutationFn: (itemId: string) =>
      call(api.DELETE('/v1/trips/{id}/items/{itemId}', { params: { path: { id, itemId } } })),
    onSuccess: setTrip,
    onError,
  });
  const publish = useMutation({
    mutationFn: (sendEmail: boolean) =>
      call(api.POST('/v1/trips/{id}/proposals', { params: { path: { id } }, body: { sendEmail } })),
    onSuccess: async (r, sendEmail) => {
      setNotice(
        `Proposal version ${r.proposal.version} published${sendEmail ? ' and emailed to your client' : ''}.${r.priceChanges.length ? ` ${r.priceChanges.length} price(s) changed since you added them.` : ''}`,
      );
      await qc.invalidateQueries({ queryKey: key });
    },
    onError,
  });
  const refresh = useMutation({
    mutationFn: () =>
      call(api.POST('/v1/trips/{id}/proposals/refresh', { params: { path: { id } } })),
    onSuccess: async (r) => {
      setNotice(
        r.republished
          ? `Prices changed: version ${r.proposal.version} is now on the same link.`
          : 'Prices checked: unchanged and valid again.',
      );
      await qc.invalidateQueries({ queryKey: key });
    },
    onError,
  });

  async function addItem(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const form = e.currentTarget;
    const f = new FormData(form);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    try {
      const kind = s('kind') as 'activity' | 'transfer' | 'note';
      setTrip(
        await call(
          api.POST('/v1/trips/{id}/items', {
            params: { path: { id } },
            body: {
              kind,
              day: s('day'),
              title: s('title'),
              ...(s('details') ? { details: s('details') } : {}),
              ...(s('startTime') ? { startTime: s('startTime') } : {}),
              ...(s('price') && kind !== 'note'
                ? { priceMinor: toMinor(s('price'), q.data!.currency) }
                : {}),
            },
          }),
        ),
      );
      form.reset();
    } catch (err) {
      onError(err);
    }
  }

  if (q.isPending) return <p className="text-muted">Loading…</p>;
  if (q.isError) return <AccessNotice error={q.error} />;
  const t = q.data;
  const editable = t.status === 'planning' || t.status === 'proposed';
  const current = t.proposals.find((p) => p.status !== 'superseded');

  return (
    <div className="flex flex-col gap-6">
      <Link href="/trips" className="text-sm text-brand-700 underline">
        All trips
      </Link>
      <div className="flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-semibold">{t.title}</h1>
        <StatusBadge status={t.status} />
      </div>
      <p className="text-muted">
        For{' '}
        <Link className="underline" href={`/clients/${t.clientId}`}>
          {t.clientName}
        </Link>{' '}
        · {t.startDate} to {t.endDate} · {t.adults} adult{t.adults === 1 ? '' : 's'}
        {t.childrenAges.length ? `, children ${t.childrenAges.join(', ')}` : ''}
      </p>
      {error && <Alert>{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}
      {!editable && (
        <Alert kind="info">This trip is {t.status}; the approved proposal is locked.</Alert>
      )}

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-6">
          <Card title="Itinerary">
            <ol className="flex flex-col gap-5">
              {days(t.startDate, t.endDate).map((day, i) => {
                const items = t.items.filter((x) => x.day === day);
                return (
                  <li key={day}>
                    <h3 className="text-sm font-semibold">
                      Day {i + 1} · {longDate(day)}
                    </h3>
                    {items.length === 0 ? (
                      <p className="text-sm text-muted">Free day</p>
                    ) : (
                      <ul className="mt-2 flex flex-col gap-2">
                        {items.map((it) => (
                          <li
                            key={it.id}
                            className="flex items-start justify-between gap-3 rounded-md border border-gray-100 p-3"
                          >
                            <div className="text-sm">
                              <p className="font-medium">
                                {it.startTime && (
                                  <span className="mr-2 text-muted">{it.startTime}</span>
                                )}
                                {it.title}
                                <span className="ml-2 text-xs uppercase text-muted">{it.kind}</span>
                              </p>
                              {it.details && <p className="text-muted">{it.details}</p>}
                              {it.hotel && (
                                <p className="text-muted">
                                  {it.hotel.rate.checkIn} to {it.hotel.rate.checkOut} ·{' '}
                                  {formatMoney(it.hotel.rate.total)} ·{' '}
                                  {it.hotel.rate.refundable ? 'refundable' : 'non-refundable'}
                                  {it.hotel.preferred && it.hotel.rate.partnerEligible && (
                                    <span className="text-green-900">
                                      {' '}
                                      · {it.hotel.preferred.programName} perks
                                    </span>
                                  )}
                                </p>
                              )}
                              {it.price && (
                                <p className="text-muted">
                                  {formatMoney({ amountMinor: it.price, currency: t.currency })}
                                </p>
                              )}
                            </div>
                            {editable && (
                              <button
                                className="text-xs text-brand-700 underline"
                                onClick={() => remove.mutate(it.id)}
                              >
                                Remove
                              </button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                );
              })}
            </ol>
          </Card>

          {editable && (
            <>
              <HotelSearch
                trip={t}
                onAdd={async (rateKey) => {
                  setTrip(
                    await call(
                      api.POST('/v1/trips/{id}/hotels', {
                        params: { path: { id } },
                        body: { rateKey },
                      }),
                    ),
                  );
                }}
              />
              <Card title="Add an activity, transfer or note">
                <form onSubmit={addItem} className="grid gap-3 sm:grid-cols-2">
                  <Select label="Type" name="kind">
                    <option value="activity">Activity</option>
                    <option value="transfer">Transfer</option>
                    <option value="note">Note</option>
                  </Select>
                  <Select label="Day" name="day">
                    {days(t.startDate, t.endDate).map((d, i) => (
                      <option key={d} value={d}>
                        Day {i + 1} · {d}
                      </option>
                    ))}
                  </Select>
                  <Field label="Title" name="title" required />
                  <Field label="Time" name="startTime" type="time" />
                  <Field label="Details" name="details" />
                  <Field
                    label={`Price (${t.currency}, optional)`}
                    name="price"
                    inputMode="decimal"
                  />
                  <div className="sm:col-span-2">
                    <Button type="submit" variant="secondary">
                      Add
                    </Button>
                  </div>
                </form>
              </Card>
            </>
          )}
        </div>

        <div className="flex flex-col gap-6">
          <Card title="Total">
            <dl className="grid grid-cols-[1fr_auto] gap-y-1 text-sm">
              {t.totals.lines.map((l) => (
                <Fragment key={l.itemId}>
                  <dt className="text-muted">{l.label}</dt>
                  <dd>{formatMoney(l.amount)}</dd>
                </Fragment>
              ))}
              <dt className="text-muted">Planning fee</dt>
              <dd>{formatMoney(t.totals.planningFee)}</dd>
              <dt className="border-t border-gray-200 pt-1 font-semibold">Total</dt>
              <dd className="border-t border-gray-200 pt-1 font-semibold">
                {formatMoney(t.totals.total)}
              </dd>
            </dl>
            <p className="mt-2 text-xs text-muted">
              Includes {formatMoney(t.totals.taxesIncluded)} taxes. Paid at hotels:{' '}
              {formatMoney(t.totals.payableAtProperty)}.
            </p>
          </Card>

          <Card title="Proposal">
            {editable && (
              <div className="flex flex-col gap-2">
                <Button
                  onClick={() => publish.mutate(Boolean(t.clientEmail))}
                  disabled={publish.isPending || t.items.length === 0}
                >
                  {current ? 'Publish an update' : 'Publish proposal'}
                  {t.clientEmail ? ' and email client' : ''}
                </Button>
                {!t.clientEmail && (
                  <p className="text-xs text-muted">
                    This client has no email address: copy the link and send it yourself.
                  </p>
                )}
              </div>
            )}
            {current && (
              <div className="mt-4 flex flex-col gap-2 text-sm">
                <p>
                  Version {current.version} · <StatusBadge status={current.status} />
                </p>
                <p className="text-muted">
                  Prices checked {new Date(current.ratesCheckedAt).toLocaleString()}; valid until{' '}
                  {new Date(current.ratesExpireAt).toLocaleString()}.
                </p>
                {current.firstViewedAt && (
                  <p className="text-muted">
                    Opened by the client {new Date(current.firstViewedAt).toLocaleString()}.
                  </p>
                )}
                {current.decisionNote && (
                  <p>
                    “{current.decisionNote}” · {current.decidedByName}
                  </p>
                )}
                {current.url && (
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      await navigator.clipboard.writeText(current.url!);
                      setCopied(true);
                    }}
                  >
                    {copied ? 'Link copied' : 'Copy client link'}
                  </Button>
                )}
                {current.status === 'published' && (
                  <Button
                    variant="secondary"
                    onClick={() => refresh.mutate()}
                    disabled={refresh.isPending}
                  >
                    Re-check prices
                  </Button>
                )}
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
