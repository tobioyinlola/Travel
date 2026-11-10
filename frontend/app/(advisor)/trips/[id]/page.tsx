'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BedDouble,
  CalendarDays,
  Car,
  ChevronLeft,
  CircleDashed,
  Copy,
  MapPin,
  RefreshCw,
  Send,
  StickyNote,
  Ticket,
  Trash2,
  UserRound,
  type LucideIcon,
} from 'lucide-react';
import Link from 'next/link';
import { Fragment, use, useState, type FormEvent } from 'react';
import { AccessNotice } from '@/components/gate';
import { BookingCard } from '@/components/booking-card';
import { Thread } from '@/components/thread';
import { HotelSearch } from '@/components/hotel-search';
import {
  Alert,
  Avatar,
  Button,
  Card,
  Field,
  ICON,
  IconButton,
  ListRow,
  Select,
  StatusBadge,
} from '@/components/ui';
import { api, API_BASE_URL, ApiError, call, formatMoney, toMinor, uploadFile } from '@/lib/api';

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
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  });
const shortDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
const KIND_ICON: Record<string, LucideIcon> = {
  hotel: BedDouble,
  activity: Ticket,
  transfer: Car,
  note: StickyNote,
};
const BOARD: Record<string, string> = {
  room_only: 'room only',
  breakfast: 'breakfast',
  half_board: 'half board',
  all_inclusive: 'all inclusive',
};

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
  const hotels = t.items.filter((i) => i.kind === 'hotel');
  const party = `${t.adults} adult${t.adults === 1 ? '' : 's'}${t.childrenAges.length ? `, ${t.childrenAges.length} child${t.childrenAges.length === 1 ? '' : 'ren'}` : ''}`;

  return (
    <div className="flex flex-col gap-4">
      {/* Header bar: back, key facts, client. */}
      <div className="flex flex-wrap items-center gap-x-10 gap-y-4 rounded-[var(--radius-card)] bg-surface p-4 pr-6">
        <Link
          href="/trips"
          aria-label="Back to trips"
          className="flex h-12 w-12 items-center justify-center rounded-full bg-canvas hover:bg-line"
        >
          <ChevronLeft {...ICON} aria-hidden />
        </Link>
        <div>
          <p className="text-xs text-muted">Trip</p>
          <h1 className="text-2xl font-normal">{t.title}</h1>
        </div>
        <div className="hidden sm:block">
          <p className="text-xs text-muted">Dates</p>
          <p className="text-lg">
            {shortDate(t.startDate)} – {shortDate(t.endDate)}
          </p>
        </div>
        <div className="hidden md:block">
          <p className="text-xs text-muted">Status</p>
          <StatusBadge status={t.status} />
        </div>
        <Link href={`/clients/${t.clientId}`} className="ml-auto flex items-center gap-3">
          <span className="text-right">
            <span className="block text-lg">{t.clientName}</span>
            <span className="block text-xs text-muted">Primary client</span>
          </span>
          <Avatar name={t.clientName} size="lg" />
        </Link>
      </div>

      {error && <Alert>{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}
      {!editable && (
        <Alert kind="info">
          {t.status === 'approved'
            ? 'Your client approved this trip. The proposal is locked while they complete the booking.'
            : `This trip is ${t.status}.`}
        </Alert>
      )}

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
        <div className="flex min-w-0 flex-col gap-4">
          <Card title="Itinerary">
            <ol className="flex flex-col gap-6">
              {days(t.startDate, t.endDate).map((day, i) => {
                const items = t.items.filter((x) => x.day === day);
                return (
                  <li key={day}>
                    <h3 className="mb-2 flex items-baseline gap-3 text-sm">
                      <span className="rounded-full bg-canvas px-3 py-1 text-xs">Day {i + 1}</span>
                      <span className="text-muted">{longDate(day)}</span>
                    </h3>
                    {items.length === 0 ? (
                      <p className="pl-1 text-sm text-muted">Free day</p>
                    ) : (
                      <ul className="flex flex-col gap-2">
                        {items.map((it) => (
                          <li key={it.id}>
                            <ListRow
                              tone="canvas"
                              icon={KIND_ICON[it.kind]}
                              title={
                                <span>
                                  {it.startTime && (
                                    <span className="mr-2 text-muted">{it.startTime}</span>
                                  )}
                                  {it.title}
                                </span>
                              }
                              subtitle={
                                it.hotel
                                  ? `${it.hotel.rate.roomName}, ${BOARD[it.hotel.rate.board]} · ${it.hotel.rate.nights} nights · ${formatMoney(it.hotel.rate.total)} · ${it.hotel.rate.refundable ? 'refundable' : 'non-refundable'}`
                                  : [
                                      it.details,
                                      it.price
                                        ? formatMoney({
                                            amountMinor: it.price,
                                            currency: t.currency,
                                          })
                                        : null,
                                    ]
                                      .filter(Boolean)
                                      .join(' · ') || undefined
                              }
                              trailing={
                                <span className="flex items-center gap-2">
                                  {it.hotel?.preferred && it.hotel.rate.partnerEligible && (
                                    <span className="hidden rounded-full bg-accent-soft px-3 py-1 text-xs text-accent-deep sm:inline">
                                      {it.hotel.preferred.programName} perks
                                    </span>
                                  )}
                                  {editable && (
                                    <IconButton
                                      icon={Trash2}
                                      label={`Remove ${it.title}`}
                                      size="sm"
                                      className="bg-canvas"
                                      onClick={() => remove.mutate(it.id)}
                                    />
                                  )}
                                </span>
                              }
                            />
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
                <form onSubmit={addItem} className="grid gap-4 sm:grid-cols-2">
                  <Select label="Type" name="kind">
                    <option value="activity">Activity</option>
                    <option value="transfer">Transfer</option>
                    <option value="note">Note</option>
                  </Select>
                  <Select label="Day" name="day">
                    {days(t.startDate, t.endDate).map((d, i) => (
                      <option key={d} value={d}>
                        Day {i + 1} · {shortDate(d)}
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
                    <Button type="submit" variant="dark">
                      Add to itinerary
                    </Button>
                  </div>
                </form>
              </Card>
            </>
          )}
        </div>

        <aside className="flex flex-col gap-4">
          <Card title="Trip details">
            <ul className="flex flex-col gap-2">
              <li>
                <ListRow
                  tone="canvas"
                  icon={CalendarDays}
                  title="Travel dates"
                  subtitle={`${shortDate(t.startDate)} – ${shortDate(t.endDate)}`}
                />
              </li>
              <li>
                <ListRow tone="canvas" icon={UserRound} title="Travelers" subtitle={party} />
              </li>
              <li>
                <ListRow
                  tone="canvas"
                  icon={MapPin}
                  title="Hotels"
                  subtitle={hotels.length ? hotels.map((h) => h.title).join(', ') : 'None yet'}
                />
              </li>
              <li>
                <ListRow
                  tone="canvas"
                  icon={CircleDashed}
                  title="Status"
                  subtitle={<StatusBadge status={t.status} />}
                />
              </li>
            </ul>
          </Card>

          <Card title="Total">
            <p className="text-4xl font-light">{formatMoney(t.totals.total)}</p>
            <dl className="mt-4 grid grid-cols-[1fr_auto] gap-y-1.5 text-sm">
              {t.totals.lines.map((l) => (
                <Fragment key={l.itemId}>
                  <dt className="truncate pr-2 text-muted">{l.label}</dt>
                  <dd>{formatMoney(l.amount)}</dd>
                </Fragment>
              ))}
              <dt className="text-muted">Planning fee</dt>
              <dd>{formatMoney(t.totals.planningFee)}</dd>
            </dl>
            <p className="mt-3 text-xs text-muted">
              Includes {formatMoney(t.totals.taxesIncluded)} taxes. Paid at hotels:{' '}
              {formatMoney(t.totals.payableAtProperty)}.
            </p>
          </Card>

          <BookingCard tripId={id} />

          <Card title="Proposal" action={current && <StatusBadge status={current.status} />}>
            {current ? (
              <div className="flex flex-col gap-2 text-sm">
                <p className="text-lg">Version {current.version}</p>
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
                  <p className="rounded-[14px] bg-canvas p-3">
                    “{current.decisionNote}” · {current.decidedByName}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-muted">
                Publish to share a priced proposal your client can approve from a link.
              </p>
            )}
            <div className="mt-4 flex flex-col gap-2">
              {editable && (
                <Button
                  icon={Send}
                  onClick={() => publish.mutate(Boolean(t.clientEmail))}
                  disabled={publish.isPending || t.items.length === 0}
                >
                  {current ? 'Publish an update' : 'Publish proposal'}
                  {t.clientEmail ? ' and email' : ''}
                </Button>
              )}
              {current?.url && (
                <Button
                  variant="secondary"
                  icon={Copy}
                  onClick={async () => {
                    await navigator.clipboard.writeText(current.url!);
                    setCopied(true);
                  }}
                >
                  {copied ? 'Link copied' : 'Copy client link'}
                </Button>
              )}
              {current?.status === 'published' && (
                <Button
                  variant="secondary"
                  icon={RefreshCw}
                  onClick={() => refresh.mutate()}
                  disabled={refresh.isPending}
                >
                  Re-check prices
                </Button>
              )}
              {editable && !t.clientEmail && (
                <p className="text-xs text-muted">
                  This client has no email address: copy the link and send it yourself.
                </p>
              )}
            </div>
          </Card>

          <Card title="Messages with your client">
            <TripMessages tripId={id} onError={onError} />
          </Card>

          {t.proposals.length > 1 && (
            <Card title="Proposal history">
              <ul className="flex flex-col gap-2 text-sm">
                {t.proposals.map((p) => (
                  <li
                    key={p.id}
                    className="flex items-center justify-between rounded-[14px] bg-canvas px-3 py-2"
                  >
                    <span>
                      Version {p.version} · {formatMoney(p.total)}
                    </span>
                    <StatusBadge status={p.status} />
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>
    </div>
  );
}

/** FR-TRV-06: the conversation the traveler starts from their proposal link. */
function TripMessages({ tripId, onError }: { tripId: string; onError: (e: unknown) => void }) {
  const qc = useQueryClient();
  const key = ['trip-thread', tripId];
  const q = useQuery({
    queryKey: key,
    queryFn: () => call(api.GET('/v1/trips/{id}/messages', { params: { path: { id: tripId } } })),
    refetchInterval: 15_000,
  });
  const read = useMutation({
    mutationFn: () =>
      call(api.POST('/v1/trips/{id}/messages/read', { params: { path: { id: tripId } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['unread-messages'] }),
  });
  const send = useMutation({
    mutationFn: ({ body, ids }: { body: string; ids: string[] }) =>
      call(
        api.POST('/v1/trips/{id}/messages', {
          params: { path: { id: tripId } },
          body: { body, ...(ids.length ? { attachmentIds: ids } : {}) },
        }),
      ),
    onSuccess: (data) => qc.setQueryData(key, data),
    onError,
  });
  const unread = q.data?.unread ?? 0;
  return (
    <Thread
      items={q.data?.items ?? []}
      mine="advisor"
      busy={send.isPending}
      onSend={(b, ids) => send.mutateAsync({ body: b, ids }).catch(() => undefined)}
      onUpload={(f) => uploadFile(`/v1/trips/${tripId}/attachments`, f)}
      fileHref={(id) => `${API_BASE_URL}/v1/trips/${tripId}/attachments/${id}`}
      placeholder="Reply to your client. They are also emailed."
    >
      {unread > 0 && (
        <Button
          variant="ghost"
          onClick={() => read.mutate(undefined, { onSuccess: () => q.refetch() })}
        >
          Mark {unread} new message{unread === 1 ? '' : 's'} as read
        </Button>
      )}
    </Thread>
  );
}
