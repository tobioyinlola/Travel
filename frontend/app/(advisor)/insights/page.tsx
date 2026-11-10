'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { AccessNotice } from '@/components/gate';
import { Card, Empty, PageHeader, Select, StatCard } from '@/components/ui';
import { api, call, formatMoney } from '@/lib/api';

const day = (d: Date) => d.toISOString().slice(0, 10);

/** The advisor's own numbers (FR-RPT-01): pipeline, bookings, commission, tier and suppliers. */
export default function InsightsPage() {
  const [days, setDays] = useState('90');
  const q = useQuery({
    queryKey: ['insights', days],
    queryFn: () =>
      call(
        api.GET('/v1/reports/advisor', {
          params: {
            query: {
              from: day(new Date(Date.now() - Number(days) * 86_400_000)),
              to: day(new Date(Date.now() + 86_400_000)),
            },
          },
        }),
      ),
    retry: false,
  });
  if (q.isPending) return <p className="text-muted">Loading…</p>;
  if (q.isError) return <AccessNotice error={q.error} />;
  const r = q.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Insights"
        subtitle="How your business is doing."
        actions={
          <Select label="Period" value={days} onChange={(e) => setDays(e.target.value)}>
            <option value="30">Last 30 days</option>
            <option value="90">Last 90 days</option>
            <option value="365">Last 12 months</option>
          </Select>
        }
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Proposals sent"
          value={r.pipeline.proposalsSent}
          caption={`${r.pipeline.proposalsApproved} approved · ${r.pipeline.approvalRatePercent}%`}
        />
        <StatCard
          label="Bookings"
          value={r.bookings.net}
          caption={`${r.bookings.confirmed} confirmed · ${r.bookings.cancelled} cancelled`}
        />
        <StatCard
          label="Booking value"
          value={formatMoney(r.bookings.value)}
          caption="Confirmed bookings"
        />
        <StatCard
          label="Commission earned"
          value={formatMoney(r.commission.earned)}
          caption={`${formatMoney(r.commission.payable)} payable · ${formatMoney(r.commission.paid)} paid`}
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Your split tier">
          <p className="text-3xl font-light">
            {r.tier.tierName} · {r.tier.advisorShareBps / 100}%
          </p>
          <p className="mt-2 text-sm text-muted">
            {formatMoney(r.tier.calendarYearSales)} in {r.tier.year} sales.{' '}
            {r.tier.next
              ? `${formatMoney(r.tier.next.remaining)} more reaches ${r.tier.next.name} (${r.tier.next.advisorShareBps / 100}%) on later bookings.`
              : 'You are on the top tier.'}
          </p>
        </Card>
        <Card title="Top suppliers">
          {r.topSuppliers.length === 0 ? (
            <Empty>No confirmed bookings in this period.</Empty>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {r.topSuppliers.map((s) => (
                <li
                  key={s.supplier}
                  className="flex items-center justify-between rounded-[14px] bg-canvas px-4 py-3"
                >
                  <span>{s.supplier}</span>
                  <span>
                    {s.hotels} hotel{s.hotels === 1 ? '' : 's'} · {formatMoney(s.value)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}
