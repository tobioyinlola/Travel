'use client';

import { useState, type FormEvent } from 'react';
import { Alert, Button, Card, Field, Select } from '@/components/ui';
import { api, ApiError, call } from '@/lib/api';

/** FR-MEM-04: promo codes, fee waivers and pilot discounts. */
export default function PromoCodesPage() {
  const [kind, setKind] = useState<'waiver' | 'percent_off' | 'amount_off'>('waiver');
  const [error, setError] = useState<ApiError | null>(null);
  const [created, setCreated] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setCreated(null);
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    try {
      const res = await call(
        api.POST('/v1/admin/promo-codes', {
          body: {
            code: s('code'),
            kind,
            ...(kind === 'percent_off'
              ? { percentBps: Math.round(Number(s('percent')) * 100) }
              : {}),
            ...(kind === 'amount_off'
              ? {
                  amount: {
                    amountMinor: String(Math.round(Number(s('amount')) * 100)),
                    currency: s('currency').toUpperCase(),
                  },
                }
              : {}),
            ...(s('description') ? { description: s('description') } : {}),
            ...(s('expiresAt') ? { expiresAt: new Date(s('expiresAt')).toISOString() } : {}),
            ...(s('maxRedemptions') ? { maxRedemptions: Number(s('maxRedemptions')) } : {}),
          },
        }),
      );
      setCreated(res.code);
      e.currentTarget.reset();
    } catch (err) {
      setError(err instanceof ApiError ? err : null);
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">Promo codes</h1>
      <Card title="New promo code">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {error && <Alert>{error.message}</Alert>}
          {created && <Alert kind="success">Created {created}.</Alert>}
          <Field
            label="Code"
            name="code"
            required
            hint="Letters, numbers, - and _"
            error={error?.fieldError('code')}
          />
          <Select
            label="Type"
            value={kind}
            onChange={(e) => setKind(e.target.value as typeof kind)}
          >
            <option value="waiver">Fee waiver (free)</option>
            <option value="percent_off">Percentage off</option>
            <option value="amount_off">Fixed amount off</option>
          </Select>
          {kind === 'percent_off' && (
            <Field
              label="Percent off"
              name="percent"
              type="number"
              min={0.01}
              max={100}
              step={0.01}
              required
            />
          )}
          {kind === 'amount_off' && (
            <div className="grid grid-cols-2 gap-4">
              <Field
                label="Amount off"
                name="amount"
                type="number"
                min={0.01}
                step={0.01}
                required
              />
              <Field label="Currency" name="currency" maxLength={3} defaultValue="USD" required />
            </div>
          )}
          <Field
            label="Description"
            name="description"
            hint="Internal note, e.g. first 100 pilot advisors"
          />
          <Field label="Expires" name="expiresAt" type="date" />
          <Field label="Maximum uses" name="maxRedemptions" type="number" min={1} />
          <Button type="submit">Create</Button>
        </form>
      </Card>
    </div>
  );
}
