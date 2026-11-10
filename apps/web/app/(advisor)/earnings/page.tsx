'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { AccessNotice } from '@/components/gate';
import { Card, Empty, ListRow, PageHeader, StatCard, StatusBadge } from '@/components/ui';
import { api, call, formatMoney } from '@/lib/api';
import { BadgeDollarSign } from 'lucide-react';

const pct = (bps: number) => `${(bps / 100).toFixed(bps % 100 ? 1 : 0)}%`;
const shortDate = (d: string) =>
  new Date(`${d}T00:00:00Z`).toLocaleDateString('en', {
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });

const STATUS_NOTE: Record<string, string> = {
  expected: 'Waiting for the hotel to pay us',
  payable: 'Ready for your next payout',
  paid: 'Paid out',
  reversed: 'Reversed (booking cancelled)',
};

/** Itemised earnings (FR-COM-08) and split tier progress (FR-MEM-05). */
export default function EarningsPage() {
  const earnings = useQuery({
    queryKey: ['earnings'],
    queryFn: () => call(api.GET('/v1/commissions', { params: { query: {} } })),
    retry: false,
  });
  const tier = useQuery({
    queryKey: ['tier'],
    queryFn: () => call(api.GET('/v1/commissions/tier')),
    retry: false,
  });

  if (earnings.isPending || tier.isPending) return <p className="text-muted">Loading…</p>;
  if (earnings.isError) return <AccessNotice error={earnings.error} />;
  const e = earnings.data;
  const t = tier.data;

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Earnings"
        subtitle="Commission on your confirmed bookings, and how it is split."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Waiting for hotels"
          value={formatMoney(e.totals.pending)}
          caption="Your share, earned"
        />
        <StatCard
          label="Payable"
          value={formatMoney(e.totals.payable)}
          caption="Ready for payout"
        />
        <StatCard label="Paid" value={formatMoney(e.totals.paid)} caption="Already paid out" />
        {t && (
          <StatCard
            label="Your split"
            value={`${pct(t.advisorShareBps)} · ${t.tierName}`}
            caption={
              t.next
                ? `${formatMoney(t.next.remaining)} more in ${t.year} sales for ${t.next.name} (${pct(t.next.advisorShareBps)})`
                : 'Top tier'
            }
          />
        )}
      </div>

      <Card title="Commission by booking">
        {e.items.length === 0 ? (
          <Empty>
            Nothing yet. Commission appears here when a booking is confirmed.{' '}
            <Link href="/trips" className="underline">
              Go to trips
            </Link>
          </Empty>
        ) : (
          <ul className="flex flex-col gap-2">
            {e.items.map((c) => (
              <li key={c.id}>
                <ListRow
                  tone="canvas"
                  icon={BadgeDollarSign}
                  title={c.propertyName}
                  subtitle={`${shortDate(c.checkIn)} – ${shortDate(c.checkOut)} · ${formatMoney(c.commissionable)} booked at ${pct(c.rateBps)} · your ${pct(c.advisorShareBps)} (${c.tier})`}
                  href={`/trips`}
                  trailing={
                    <span className="flex flex-col items-end gap-1">
                      <span className="text-lg">{formatMoney(c.advisorShare)}</span>
                      <span title={STATUS_NOTE[c.status] ?? ''}>
                        <StatusBadge status={c.status} />
                      </span>
                    </span>
                  }
                />
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="px-2 text-xs text-muted">
        Your share becomes payable once the hotel has paid us the commission. A cancelled booking
        earns nothing. The split is set by your tier when the booking is confirmed; reaching a new
        tier applies to later bookings.
      </p>
    </div>
  );
}
