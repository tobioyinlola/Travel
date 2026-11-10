'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { AccessNotice } from '@/components/gate';
import {
  Alert,
  Button,
  Card,
  Empty,
  Field,
  ListRow,
  PageHeader,
  StatCard,
  StatusBadge,
} from '@/components/ui';
import { api, ApiError, call, formatMoney } from '@/lib/api';
import { BadgeDollarSign, Landmark } from 'lucide-react';
import { useState, type FormEvent } from 'react';

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

  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const payouts = useQuery({
    queryKey: ['payouts'],
    queryFn: () => call(api.GET('/v1/payouts')),
    retry: false,
  });
  const saveAccount = useMutation({
    mutationFn: (b: { accountRef: string; country: string }) =>
      call(api.PUT('/v1/payouts/account', { body: b })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['payouts'] }),
    onError: (e) =>
      setError(
        e instanceof ApiError
          ? `${e.problem.title}. ${e.problem.detail ?? ''}`
          : 'Something went wrong',
      ),
  });
  function onAccount(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    saveAccount.mutate({
      accountRef: String(f.get('accountRef')).trim(),
      country: String(f.get('country')).trim().toUpperCase(),
    });
  }

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
      {payouts.data && (
        <Card
          title="Payouts"
          action={<StatusBadge status={payouts.data.eligible ? 'active' : 'pending'} />}
        >
          <div className="grid gap-6 lg:grid-cols-2">
            <form onSubmit={onAccount} className="flex flex-col gap-3">
              {error && <Alert>{error}</Alert>}
              <p className="text-sm text-muted">
                {payouts.data.account
                  ? `Paid to ${payouts.data.account.accountRef} (${payouts.data.account.country}).`
                  : 'Add where we should send your payouts.'}
              </p>
              <Field
                label="Payout account reference"
                name="accountRef"
                required
                pattern="acct_[a-z0-9_]{3,60}"
                hint="From our payment partner's secure form; we never see bank details."
                defaultValue={payouts.data.account?.accountRef ?? ''}
              />
              <Field
                label="Country (2 letters)"
                name="country"
                required
                maxLength={2}
                defaultValue={payouts.data.account?.country ?? ''}
              />
              <Button type="submit" icon={Landmark} disabled={saveAccount.isPending}>
                Save payout account
              </Button>
            </form>
            <div className="flex flex-col gap-2 text-sm">
              <p>
                Ready to pay:{' '}
                <strong className="text-lg font-normal">{formatMoney(payouts.data.payable)}</strong>
                {payouts.data.openDebt.amountMinor !== '0' && (
                  <span className="text-muted">
                    {' '}
                    · {formatMoney(payouts.data.openDebt)} will be deducted for cancelled bookings
                    that were already paid
                  </span>
                )}
              </p>
              {payouts.data.blockers.length > 0 && (
                <Alert kind="info">
                  Not paying out yet:{' '}
                  {payouts.data.blockers
                    .map(
                      (b) =>
                        ({
                          not_active: 'your account is not active',
                          no_payout_account: 'add a payout account',
                          on_hold: 'a hold is on your payouts, contact support',
                        })[b] ?? b,
                    )
                    .join('; ')}
                  .
                </Alert>
              )}
              <p className="text-xs text-muted">
                Payouts of {formatMoney(payouts.data.minimumPayout)} or more go out in the next run.
              </p>
            </div>
          </div>
          {payouts.data.payouts.length > 0 && (
            <ul className="mt-4 flex flex-col gap-2">
              {payouts.data.payouts.map((p) => (
                <li key={p.id} className="rounded-[18px] bg-canvas p-4 text-sm">
                  <p className="flex items-center justify-between gap-2">
                    <span className="text-base">
                      {p.paidAt ? new Date(p.paidAt).toLocaleDateString() : 'Payout'} ·{' '}
                      {formatMoney(p.net)}
                    </span>
                    <StatusBadge status={p.status} />
                  </p>
                  {p.debtApplied.amountMinor !== '0' && (
                    <p className="text-muted">
                      {formatMoney(p.gross)} earned, {formatMoney(p.debtApplied)} deducted for
                      cancelled bookings.
                    </p>
                  )}
                  <ul className="mt-2 text-muted">
                    {p.lines.map((l) => (
                      <li key={l.commissionId}>
                        {l.propertyName}: {formatMoney(l.advisorShare)}
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}
        </Card>
      )}
      <p className="px-2 text-xs text-muted">
        Your share becomes payable once the hotel has paid us the commission. A cancelled booking
        earns nothing. The split is set by your tier when the booking is confirmed; reaching a new
        tier applies to later bookings.
      </p>
    </div>
  );
}
