'use client';

import { useQuery } from '@tanstack/react-query';
import { AccessNotice } from '@/components/gate';
import { Card, Empty, PageHeader, StatCard } from '@/components/ui';
import { api, call, formatMoney } from '@/lib/api';

/** Platform health and finance numbers (FR-RPT-02, 03). */
export default function ReportsPage() {
  const platform = useQuery({
    queryKey: ['rep-platform'],
    queryFn: () => call(api.GET('/v1/reports/platform', { params: { query: {} } })),
    retry: false,
  });
  const finance = useQuery({
    queryKey: ['rep-finance'],
    queryFn: () => call(api.GET('/v1/reports/finance', { params: { query: {} } })),
    retry: false,
  });
  if (platform.isPending || finance.isPending) return <p className="text-muted">Loading…</p>;
  if (platform.isError) return <AccessNotice error={platform.error} />;
  const p = platform.data;
  const f = finance.data;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Reports" subtitle="The last 90 days." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active advisors"
          value={p.activeAdvisors}
          caption="Booked in the last 90 days"
        />
        <StatCard
          label="Bookings confirmed"
          value={p.bookings.confirmed}
          caption={`${p.bookings.cancelled} cancelled · ${p.bookings.failed} failed`}
        />
        <StatCard
          label="Booking value"
          value={formatMoney(p.bookings.gmv)}
          caption={`${p.bookings.proposalToBookingPercent}% of proposals become bookings`}
        />
        <StatCard
          label="Days to first booking"
          value={p.activation.medianDaysActiveToFirstBooking ?? '—'}
          caption="Median, from becoming active"
        />
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Advisor activation">
          <ol className="flex flex-col gap-2 text-sm">
            {(
              [
                ['Applied', p.activation.applied],
                ['Approved', p.activation.approved],
                ['Active', p.activation.active],
                ['Made a booking', p.activation.booked],
              ] as const
            ).map(([label, n]) => (
              <li
                key={label}
                className="flex items-center justify-between rounded-[14px] bg-canvas px-4 py-3"
              >
                <span>{label}</span>
                <strong className="text-lg font-normal">{n}</strong>
              </li>
            ))}
          </ol>
        </Card>
        <Card title="Bookings by supplier">
          {p.bySupplier.length === 0 ? (
            <Empty>No confirmed bookings in this period.</Empty>
          ) : (
            <ul className="flex flex-col gap-2 text-sm">
              {p.bySupplier.map((s) => (
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
      {f && (
        <Card title="Commission">
          <dl className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-4">
            {(
              [
                ['Recognised', f.commission.recognized],
                ['Advisor share', f.commission.advisorShare],
                ['Platform share', f.commission.platformShare],
                ['Reversed (advisor share)', f.commission.reversed],
                ['Received from suppliers', f.commission.receivedFromSuppliers],
                ['Made payable', f.commission.madePayable],
                ['Paid to advisors', f.commission.paidToAdvisors],
                ['Still to collect', f.commission.outstanding],
              ] as const
            ).map(([label, m]) => (
              <div key={label}>
                <dt className="text-muted">{label}</dt>
                <dd className="text-lg">{formatMoney(m)}</dd>
              </div>
            ))}
          </dl>
        </Card>
      )}
    </div>
  );
}
