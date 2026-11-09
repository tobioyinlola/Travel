'use client';

import { useQuery } from '@tanstack/react-query';
import { Minus, Plus, UserPlus, Users, X } from 'lucide-react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { DateRange, formatDay } from '@/components/date-range';
import { AccessNotice } from '@/components/gate';
import {
  Alert,
  Avatar,
  Button,
  ButtonLink,
  Card,
  Field,
  ICON,
  IconButton,
  PageHeader,
  Select,
} from '@/components/ui';
import { api, ApiError, call, toMinor } from '@/lib/api';

const iso = (d: Date) => d.toISOString().slice(0, 10);
const plusDays = (n: number) => iso(new Date(Date.now() + n * 86_400_000));

function NewTrip() {
  const router = useRouter();
  const params = useSearchParams();
  const clients = useQuery({
    queryKey: ['clients-all'],
    queryFn: () => call(api.GET('/v1/clients', { params: { query: { limit: 100 } } })),
    retry: false,
  });
  const [clientId, setClientId] = useState(params.get('clientId') ?? '');
  const [title, setTitle] = useState('');
  const [dates, setDates] = useState({ start: plusDays(30), end: plusDays(37) });
  const [adults, setAdults] = useState(2);
  const [children, setChildren] = useState<number[]>([]);
  const [currency, setCurrency] = useState('USD');
  const [fee, setFee] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (clients.isError) return <AccessNotice error={clients.error} />;
  const list = clients.data?.items ?? [];
  const client = list.find((c) => c.id === (clientId || list[0]?.id));
  const nights = Math.round((Date.parse(dates.end) - Date.parse(dates.start)) / 86_400_000);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!client) return;
    setError(null);
    setBusy(true);
    try {
      const trip = await call(
        api.POST('/v1/trips', {
          body: {
            clientId: client.id,
            title: title.trim() || `${client.firstName}'s trip`,
            startDate: dates.start,
            endDate: dates.end,
            adults,
            childrenAges: children,
            currency,
            ...(fee.trim() ? { planningFeeMinor: toMinor(fee, currency) } : {}),
          },
        }),
      );
      router.push(`/trips/${trip.id}`);
    } catch (err) {
      setError(
        err instanceof ApiError
          ? `${err.problem.title}. ${err.problem.detail ?? ''}`
          : err instanceof Error
            ? err.message
            : 'Something went wrong',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="flex flex-col gap-6">
      <PageHeader
        title="New trip"
        subtitle="Create a trip, then add hotels, activities and transfers"
        actions={
          <ButtonLink href="/trips" variant="secondary">
            Cancel
          </ButtonLink>
        }
      />
      {error && <Alert>{error}</Alert>}

      {clients.isSuccess && list.length === 0 ? (
        <Card>
          <p className="text-lg">Add a client first</p>
          <p className="mt-1 text-muted">
            Trips belong to a client. Add their details, then plan the trip.
          </p>
          <ButtonLink href="/clients/new" icon={UserPlus} className="mt-4">
            Add client
          </ButtonLink>
        </Card>
      ) : (
        <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
          <div className="flex flex-col gap-4">
            <Card title="Trip setup">
              <div className="grid gap-4 md:grid-cols-2">
                <Field
                  label="Trip name"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Lisbon family week"
                  maxLength={150}
                />
                <Select
                  label="Currency"
                  value={currency}
                  onChange={(e) => setCurrency(e.target.value)}
                >
                  {['USD', 'EUR', 'GBP', 'NGN', 'ZAR'].map((c) => (
                    <option key={c}>{c}</option>
                  ))}
                </Select>
                <div className="md:col-span-2">
                  <DateRange
                    start={dates.start}
                    end={dates.end}
                    min={plusDays(0)}
                    onChange={(start, end) => setDates({ start, end })}
                  />
                </div>
                <Field
                  label={`Planning fee (${currency}, optional)`}
                  value={fee}
                  onChange={(e) => setFee(e.target.value)}
                  inputMode="decimal"
                  hint="Shown to the client as its own line"
                />
              </div>
            </Card>

            <Card
              title="Client"
              action={
                <ButtonLink
                  href="/clients/new"
                  icon={UserPlus}
                  variant="secondary"
                  className="h-10 px-4 text-sm"
                >
                  Add new client
                </ButtonLink>
              }
            >
              <div className="flex flex-col gap-2" role="radiogroup" aria-label="Client">
                {list.map((c) => {
                  const selected = client?.id === c.id;
                  return (
                    <div key={c.id}>
                      <button
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setClientId(c.id)}
                        className={`flex w-full items-center gap-4 rounded-[20px] p-2.5 pr-4 text-left ${selected ? 'bg-accent-soft ring-1 ring-accent' : 'bg-canvas hover:bg-line'}`}
                      >
                        <Avatar name={`${c.firstName} ${c.lastName}`} />
                        <span className="flex-1">
                          <span className="block">
                            {c.firstName} {c.lastName}
                          </span>
                          <span
                            className={`block text-xs ${selected ? 'text-accent-deep' : 'text-muted'}`}
                          >
                            {c.email ?? c.phone ?? 'No contact details'}
                          </span>
                        </span>
                        {selected && (
                          <span className="text-xs font-medium text-accent-deep">Selected</span>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>
            </Card>

            <Card title="Travelers">
              <div className="flex flex-wrap items-center gap-6">
                <div className="flex items-center gap-3">
                  <Users {...ICON} aria-hidden />
                  <span className="text-sm">Adults</span>
                  <IconButton
                    type="button"
                    icon={Minus}
                    label="Fewer adults"
                    size="sm"
                    className="bg-canvas"
                    onClick={() => setAdults(Math.max(1, adults - 1))}
                  />
                  <span className="w-6 text-center text-lg" aria-live="polite">
                    {adults}
                  </span>
                  <IconButton
                    type="button"
                    icon={Plus}
                    label="More adults"
                    size="sm"
                    className="bg-canvas"
                    onClick={() => setAdults(Math.min(12, adults + 1))}
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm">Children</span>
                  {children.map((age, i) => (
                    <span
                      key={i}
                      className="inline-flex h-10 items-center gap-1 rounded-full bg-canvas pl-3 pr-1 text-sm"
                    >
                      <label className="sr-only" htmlFor={`age-${i}`}>
                        Child {i + 1} age
                      </label>
                      <select
                        id={`age-${i}`}
                        value={age}
                        onChange={(e) =>
                          setChildren(
                            children.map((x, j) => (j === i ? Number(e.target.value) : x)),
                          )
                        }
                        className="bg-transparent outline-none"
                      >
                        {Array.from({ length: 18 }, (_, a) => (
                          <option key={a} value={a}>
                            {a} yrs
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        aria-label={`Remove child ${i + 1}`}
                        onClick={() => setChildren(children.filter((_, j) => j !== i))}
                        className="flex h-8 w-8 items-center justify-center rounded-full hover:bg-line"
                      >
                        <X {...ICON} size={14} aria-hidden />
                      </button>
                    </span>
                  ))}
                  {children.length < 8 && (
                    <Button
                      type="button"
                      variant="secondary"
                      icon={Plus}
                      className="h-10 px-4 text-sm"
                      onClick={() => setChildren([...children, 8])}
                    >
                      Add child
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          </div>

          <aside className="flex flex-col gap-4">
            <Card title="Trip overview" className="xl:sticky xl:top-6">
              {client && (
                <div className="flex items-center gap-3">
                  <Avatar name={`${client.firstName} ${client.lastName}`} size="lg" />
                  <div>
                    <p className="text-lg">
                      {client.firstName} {client.lastName}
                    </p>
                    <p className="text-xs text-muted">Primary client</p>
                  </div>
                </div>
              )}
              <dl className="mt-6 grid grid-cols-2 gap-4">
                <div>
                  <dt className="text-xs text-muted">From</dt>
                  <dd className="text-lg">{formatDay(dates.start)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">To</dt>
                  <dd className="text-lg">{formatDay(dates.end)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Nights</dt>
                  <dd className="text-lg">{nights}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">Travelers</dt>
                  <dd className="text-lg">{adults + children.length}</dd>
                </div>
              </dl>
              <Button
                type="submit"
                disabled={busy || !client || nights < 0}
                className="mt-6 w-full"
              >
                {busy ? 'Creating…' : 'Create trip'}
              </Button>
              <p className="mt-3 text-xs text-muted">
                Next you add hotels from live supplier rates.{' '}
                <Link className="underline" href="/learn/essentials">
                  How proposals work
                </Link>
              </p>
            </Card>
          </aside>
        </div>
      )}
    </form>
  );
}

export default function NewTripPage() {
  return (
    <Suspense>
      <NewTrip />
    </Suspense>
  );
}
