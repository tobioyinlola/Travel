'use client';

import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, Luggage, Plus } from 'lucide-react';
import Link from 'next/link';
import { BarChart, RankList } from '@/components/charts';
import { ApplicationProgress } from '@/components/application-progress';
import {
  ArrowLink,
  ButtonLink,
  Card,
  Empty,
  Flag,
  ICON,
  ListRow,
  StatCard,
  StatusBadge,
} from '@/components/ui';
import { WorldMap } from '@/components/world-map';
import { api, ApiError, call, formatMoney } from '@/lib/api';
import { useMe } from '@/lib/session';

function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

const shortDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

export default function DashboardPage() {
  const { data: me } = useMe();
  const summary = useQuery({
    queryKey: ['trip-summary'],
    queryFn: () => call(api.GET('/v1/trips/summary')),
    retry: false,
  });
  const name = (me?.displayName ?? '').split(' ')[0] || 'there';
  const today = new Date().toLocaleDateString('en', {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
  });

  const header = (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl font-normal tracking-tight sm:text-4xl">
          {greeting()}, {name}
        </h1>
        <p className="mt-1 text-muted">{today}</p>
      </div>
      {summary.isSuccess && (
        <ButtonLink href="/trips/new" icon={Plus}>
          New trip
        </ButtonLink>
      )}
    </div>
  );

  // Applicants and approved-but-not-yet-active advisors see their onboarding progress instead.
  if (summary.isError && summary.error instanceof ApiError && summary.error.status === 403) {
    return (
      <div className="flex flex-col gap-6">
        {header}
        <ApplicationProgress />
      </div>
    );
  }
  if (summary.isPending)
    return (
      <div className="flex flex-col gap-6">
        {header}
        <p className="text-muted">Loading…</p>
      </div>
    );
  if (summary.isError)
    return (
      <div className="flex flex-col gap-6">
        {header}
        <Empty>Could not load your dashboard.</Empty>
      </div>
    );

  const s = summary.data;
  const countries = [...new Set(s.destinations.map((d) => d.countryCode))];
  const weekday = (d: string) =>
    new Date(`${d}T00:00:00Z`).toLocaleDateString('en', { weekday: 'short', timeZone: 'UTC' });

  return (
    <div className="flex flex-col gap-6">
      {header}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Trips"
          value={s.counts.total}
          caption={`${s.counts.upcoming} upcoming`}
          href="/trips"
        />
        <StatCard
          label="Awaiting client"
          value={s.counts.proposed}
          caption="Proposals sent, not yet answered"
          href="/trips"
        />
        <StatCard label="Clients" value={s.clients} caption="Active profiles" href="/clients" />
        <StatCard
          label="Pipeline value"
          value={formatMoney(s.pipelineValue)}
          caption={`${formatMoney(s.approvedValue)} approved`}
        />
      </div>

      <div className="grid gap-4 xl:grid-cols-[1.4fr_1fr]">
        <Card
          title={
            <span className="flex flex-col">
              <span>Active destinations</span>
              <span className="mt-1 text-4xl font-light text-ink">{s.destinations.length}</span>
            </span>
          }
          className="flex flex-col"
        >
          <div className="mt-2 flex-1">
            <WorldMap
              countries={countries}
              label={`Destinations: ${s.destinations.map((d) => d.city).join(', ') || 'none yet'}`}
            />
          </div>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-1 2xl:grid-cols-2">
          <Card
            title={
              <span className="flex flex-col">
                <span>Proposals sent</span>
                <span className="mt-1 text-4xl font-light text-ink">
                  {s.proposalsLast7Days.reduce((a, b) => a + b.proposals, 0)}
                </span>
                <span className="text-xs">last 7 days</span>
              </span>
            }
            action={<ArrowLink href="/trips" label="Open trips" />}
          >
            <BarChart
              label="Proposals sent per day"
              data={s.proposalsLast7Days.map((d) => ({
                label: weekday(d.day),
                value: d.proposals,
              }))}
            />
          </Card>
          <Card
            title={
              <span className="flex flex-col">
                <span>Top destinations</span>
                <span className="mt-1 text-4xl font-light text-ink">{s.destinations.length}</span>
                <span className="text-xs">across your trips</span>
              </span>
            }
          >
            {s.destinations.length === 0 ? (
              <p className="text-sm text-muted">
                Add a hotel to a trip and its destination shows here.
              </p>
            ) : (
              <RankList
                items={s.destinations.slice(0, 5).map((d) => ({
                  key: `${d.countryCode}-${d.city}`,
                  label: (
                    <span className="inline-flex items-center gap-2">
                      <Flag code={d.countryCode} />
                      {d.city}
                    </span>
                  ),
                  value: d.trips,
                  caption: `${d.trips} trip${d.trips === 1 ? '' : 's'}`,
                }))}
              />
            )}
          </Card>
        </div>
      </div>

      <Card title="Coming up" action={<ArrowLink href="/trips" label="All trips" />}>
        {s.upcoming.length === 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted">
              No trips yet. Plan one for a client to get started.
            </p>
            <ButtonLink href="/trips/new" icon={Plus} variant="secondary">
              New trip
            </ButtonLink>
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {s.upcoming.map((t) => (
              <li key={t.id}>
                <ListRow
                  href={`/trips/${t.id}`}
                  leading={
                    <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[14px] bg-canvas text-xl">
                      {t.destination ? (
                        <Flag code={t.destination.countryCode} />
                      ) : (
                        <Luggage {...ICON} aria-hidden />
                      )}
                    </span>
                  }
                  title={
                    <span>
                      {t.title} <span className="text-muted">· {t.clientName}</span>
                    </span>
                  }
                  subtitle={`${shortDate(t.startDate)} – ${shortDate(t.endDate)} · ${t.nights} nights · ${formatMoney(t.total)}`}
                  trailing={
                    <span className="flex items-center gap-3">
                      <StatusBadge status={t.status} />
                      <ArrowUpRight {...ICON} aria-hidden />
                    </span>
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="text-xs text-muted">
        Figures come from your trips. Bookings and commission join the dashboard once booking is
        live.{' '}
        <Link className="underline" href="/learn">
          Learn how commission works
        </Link>
      </p>
    </div>
  );
}
