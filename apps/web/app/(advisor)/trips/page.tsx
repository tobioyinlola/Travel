'use client';

import { useQuery } from '@tanstack/react-query';
import { Luggage, Plus } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { FilterBar } from '@/components/filter-bar';
import { AccessNotice } from '@/components/gate';
import { ButtonLink, Empty, Flag, ICON, PageHeader, StatCard, StatusBadge } from '@/components/ui';
import { api, call, formatMoney } from '@/lib/api';

const range = (a: string, b: string) => {
  const f = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString('en', {
      month: 'short',
      day: 'numeric',
      timeZone: 'UTC',
    });
  return `${f(a)} – ${f(b)}`;
};

const STATUS_OPTIONS = [
  { value: 'planning', label: 'Planning' },
  { value: 'proposed', label: 'Proposed' },
  { value: 'approved', label: 'Approved' },
  { value: 'cancelled', label: 'Cancelled' },
];

export default function TripsPage() {
  const router = useRouter();
  const [filters, setFilters] = useState<Record<string, string | undefined>>({});
  const [q, setQ] = useState<string | undefined>();
  const trips = useQuery({
    queryKey: ['trips'],
    queryFn: () => call(api.GET('/v1/trips')),
    retry: false,
  });

  const all = trips.data ?? [];
  const clients = useMemo(
    () => [...new Map(all.map((t) => [t.clientId, t.clientName])).entries()],
    [all],
  );
  const rows = all.filter(
    (t) =>
      (!filters.status || t.status === filters.status) &&
      (!filters.client || t.clientId === filters.client) &&
      (!q ||
        `${t.title} ${t.clientName} ${t.destination?.city ?? ''}`
          .toLowerCase()
          .includes(q.toLowerCase())),
  );
  const pct = (n: number) => (all.length ? `${Math.round((n / all.length) * 100)}% of trips` : '—');
  const count = (s: string) => all.filter((t) => t.status === s).length;

  if (trips.isError) return <AccessNotice error={trips.error} />;

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Trips"
        subtitle="Manage every trip and track where each one stands"
        actions={
          <FilterBar
            filters={[
              { key: 'status', label: 'Status', options: STATUS_OPTIONS },
              {
                key: 'client',
                label: 'Client',
                options: clients.map(([value, label]) => ({ value, label })),
              },
            ]}
            values={filters}
            onChange={setFilters}
            search={q}
            onSearch={setQ}
            searchLabel="Search trips"
          >
            <ButtonLink href="/trips/new" icon={Plus}>
              New trip
            </ButtonLink>
          </FilterBar>
        }
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard label="Total trips" value={all.length} caption="all time" />
        <StatCard label="Planning" value={count('planning')} caption={pct(count('planning'))} />
        <StatCard
          label="Awaiting client"
          value={count('proposed')}
          caption={pct(count('proposed'))}
        />
        <StatCard label="Approved" value={count('approved')} caption={pct(count('approved'))} />
      </div>

      {trips.isPending ? (
        <p className="text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <Empty>
          {all.length === 0
            ? 'No trips yet. Create one for a client to get started.'
            : 'No trips match these filters.'}
        </Empty>
      ) : (
        <div className="overflow-x-auto rounded-[var(--radius-card)] bg-surface p-3">
          <table className="w-full min-w-[760px] text-left text-sm">
            <caption className="sr-only">Your trips</caption>
            <thead className="text-xs text-muted">
              <tr>
                <th className="px-3 py-3 font-normal">Trip</th>
                <th className="px-3 py-3 font-normal">Dates</th>
                <th className="px-3 py-3 font-normal">Travelers</th>
                <th className="px-3 py-3 font-normal">Status</th>
                <th className="px-3 py-3 text-right font-normal">Total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr
                  key={t.id}
                  onClick={() => router.push(`/trips/${t.id}`)}
                  className="cursor-pointer border-t border-line hover:bg-canvas/60"
                >
                  <td className="px-3 py-3">
                    <Link
                      href={`/trips/${t.id}`}
                      className="flex items-center gap-3"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-canvas text-xl">
                        {t.destination ? (
                          <Flag code={t.destination.countryCode} />
                        ) : (
                          <Luggage {...ICON} aria-hidden />
                        )}
                      </span>
                      <span>
                        <span className="block text-[15px]">{t.title}</span>
                        <span className="block text-xs text-muted">
                          {t.clientName}
                          {t.destination ? ` · ${t.destination.city}` : ''}
                        </span>
                      </span>
                    </Link>
                  </td>
                  <td className="px-3 py-3">
                    <span className="block">{range(t.startDate, t.endDate)}</span>
                    <span className="block text-xs text-muted">{t.nights} nights</span>
                  </td>
                  <td className="px-3 py-3">{t.travelers}</td>
                  <td className="px-3 py-3">
                    <StatusBadge status={t.status} />
                  </td>
                  <td className="px-3 py-3 text-right">
                    {t.itemCount ? formatMoney(t.total) : <span className="text-muted">—</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
