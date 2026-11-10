'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { AccessNotice } from '@/components/gate';
import { Alert, Button, Card, Field, PageHeader } from '@/components/ui';
import { api, ApiError, call, formatMoney, toMinor } from '@/lib/api';

const errText = (e: unknown) =>
  e instanceof ApiError ? `${e.problem.title}. ${e.problem.detail ?? ''}` : 'Something went wrong';

/** Kill switches, plans and the split ladder, changed without a deploy (FR-ADM-04). */
export default function SettingsPage() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const flags = useQuery({
    queryKey: ['flags'],
    queryFn: () => call(api.GET('/v1/admin/flags')),
    retry: false,
  });
  const plans = useQuery({ queryKey: ['plans'], queryFn: () => call(api.GET('/v1/admin/plans')) });
  const tiers = useQuery({ queryKey: ['tiers'], queryFn: () => call(api.GET('/v1/admin/tiers')) });
  const done = (msg: string) => async () => {
    setError(null);
    setNotice(msg);
    await qc.invalidateQueries();
  };
  const onError = (e: unknown) => {
    setNotice(null);
    setError(errText(e));
  };

  const setFlag = useMutation({
    mutationFn: (v: { key: string; enabled: boolean }) =>
      call(
        api.PUT('/v1/admin/flags/{key}', {
          params: { path: { key: v.key } },
          body: { enabled: v.enabled },
        }),
      ),
    onSuccess: done('Saved. It takes effect within a few seconds.'),
    onError,
  });
  const savePlan = useMutation({
    mutationFn: (v: {
      code: string;
      name: string;
      billingPeriod: 'quarter' | 'year';
      priceMinor: string;
      active: boolean;
    }) =>
      call(
        api.PUT('/v1/admin/plans/{code}', {
          params: { path: { code: v.code } },
          body: {
            name: v.name,
            billingPeriod: v.billingPeriod,
            priceMinor: v.priceMinor,
            active: v.active,
            currency: 'USD',
          },
        }),
      ),
    onSuccess: done('Plan saved. New charges use it; existing invoices are unchanged.'),
    onError,
  });
  const saveTiers = useMutation({
    mutationFn: (
      t: Array<{ code: string; name: string; minSalesMinor: string; advisorShareBps: number }>,
    ) => call(api.PUT('/v1/admin/tiers', { body: { tiers: t } })),
    onSuccess: done('Split ladder saved. It applies to sales from now on.'),
    onError,
  });

  if (flags.isPending) return <p className="text-muted">Loading…</p>;
  if (flags.isError) return <AccessNotice error={flags.error} />;

  function onTiers(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    saveTiers.mutate(
      (tiers.data?.items ?? []).map((t) => ({
        code: t.code,
        name: t.name,
        minSalesMinor: toMinor(String(f.get(`min-${t.code}`)), 'USD'),
        advisorShareBps: Math.round(Number(f.get(`share-${t.code}`)) * 100),
      })),
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Settings" subtitle="Changes are audited and need no deploy." />
      {error && <Alert>{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}

      <Card title="Kill switches">
        <ul className="flex flex-col gap-3">
          {flags.data.items.map((f) => (
            <li
              key={f.key}
              className="flex items-start justify-between gap-3 rounded-[14px] bg-canvas p-4 text-sm"
            >
              <span>
                <span className="block text-base">{f.key.replace(/_/g, ' ')}</span>
                <span className="block text-muted">{f.description}</span>
              </span>
              <label className="flex items-center gap-2 whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={f.enabled}
                  onChange={(e) => setFlag.mutate({ key: f.key, enabled: e.target.checked })}
                />
                {f.enabled ? 'On' : 'Paused'}
              </label>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Membership plans">
        <ul className="flex flex-col gap-3">
          {plans.data?.items.map((p) => (
            <li key={p.code}>
              <form
                className="grid items-end gap-3 rounded-[14px] bg-canvas p-4 sm:grid-cols-[1fr_140px_auto_auto]"
                onSubmit={(e) => {
                  e.preventDefault();
                  const f = new FormData(e.currentTarget);
                  savePlan.mutate({
                    code: p.code,
                    name: String(f.get('name')),
                    billingPeriod: p.billingPeriod,
                    priceMinor: toMinor(String(f.get('price')), 'USD'),
                    active: f.get('active') === 'on',
                  });
                }}
              >
                <Field
                  label={`${p.code} (${p.billingPeriod === 'year' ? 'yearly' : 'quarterly'})`}
                  name="name"
                  defaultValue={p.name}
                  required
                />
                <Field
                  label="Price (USD)"
                  name="price"
                  defaultValue={(Number(p.price.amountMinor) / 100).toFixed(2)}
                  required
                />
                <label className="flex items-center gap-2 pb-3 text-sm">
                  <input type="checkbox" name="active" defaultChecked={p.active} /> Offered
                </label>
                <Button type="submit" variant="secondary">
                  Save
                </Button>
              </form>
              <p className="px-2 pt-1 text-xs text-muted">Currently {formatMoney(p.price)}.</p>
            </li>
          ))}
        </ul>
      </Card>

      <Card title="Advisor split ladder">
        <form onSubmit={onTiers} className="flex flex-col gap-3">
          {tiers.data?.items.map((t) => (
            <div
              key={t.code}
              className="grid items-end gap-3 rounded-[14px] bg-canvas p-4 sm:grid-cols-3"
            >
              <p className="pb-3 text-base">{t.name}</p>
              <Field
                label="From calendar-year sales (USD)"
                name={`min-${t.code}`}
                defaultValue={(Number(t.minSales.amountMinor) / 100).toFixed(2)}
                readOnly={t.position === 1}
                required
              />
              <Field
                label="Advisor share (%)"
                name={`share-${t.code}`}
                defaultValue={String(t.advisorShareBps / 100)}
                required
              />
            </div>
          ))}
          <Button type="submit">Save ladder</Button>
          <p className="text-xs text-muted">
            The first tier starts at zero, thresholds rise, and a higher tier never pays less. Tiers
            cannot be removed.
          </p>
        </form>
      </Card>
    </div>
  );
}
