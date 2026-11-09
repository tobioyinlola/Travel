'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter, useSearchParams } from 'next/navigation';
import { Suspense, useState, type FormEvent } from 'react';
import { AccessNotice } from '@/components/gate';
import { Alert, Button, Card, Field, Select } from '@/components/ui';
import { api, ApiError, call, toMinor } from '@/lib/api';

function NewTrip() {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<ApiError | string | null>(null);
  const clients = useQuery({
    queryKey: ['clients-all'],
    queryFn: () => call(api.GET('/v1/clients', { params: { query: { limit: 100 } } })),
    retry: false,
  });
  if (clients.isError) return <AccessNotice error={clients.error} />;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    const s = (k: string) => String(f.get(k) ?? '').trim();
    try {
      const currency = s('currency').toUpperCase() || 'USD';
      const trip = await call(
        api.POST('/v1/trips', {
          body: {
            clientId: s('clientId'),
            title: s('title'),
            startDate: s('startDate'),
            endDate: s('endDate'),
            adults: Number(s('adults')),
            childrenAges: s('childrenAges')
              ? s('childrenAges')
                  .split(',')
                  .map((x) => Number(x.trim()))
              : [],
            currency,
            ...(s('fee') ? { planningFeeMinor: toMinor(s('fee'), currency) } : {}),
          },
        }),
      );
      router.push(`/trips/${trip.id}`);
    } catch (err) {
      setError(
        err instanceof ApiError ? err : err instanceof Error ? err.message : 'Something went wrong',
      );
    }
  }

  const apiError = error instanceof ApiError ? error : null;
  return (
    <div className="mx-auto max-w-2xl">
      <Card title="New trip">
        {clients.data && clients.data.items.length === 0 ? (
          <Alert kind="info">Add a client first, then plan a trip for them.</Alert>
        ) : (
          <form onSubmit={onSubmit} className="grid gap-4 sm:grid-cols-2">
            {error && (
              <div className="sm:col-span-2">
                <Alert>{typeof error === 'string' ? error : error.message}</Alert>
              </div>
            )}
            <div className="sm:col-span-2">
              <Select
                label="Client"
                name="clientId"
                defaultValue={params.get('clientId') ?? undefined}
              >
                {clients.data?.items.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.firstName} {c.lastName}
                  </option>
                ))}
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Field
                label="Trip name"
                name="title"
                required
                placeholder="Lisbon family week"
                error={apiError?.fieldError('title')}
              />
            </div>
            <Field label="Start date" name="startDate" type="date" required />
            <Field label="End date" name="endDate" type="date" required />
            <Field
              label="Adults"
              name="adults"
              type="number"
              min={1}
              max={12}
              defaultValue={2}
              required
            />
            <Field
              label="Children's ages"
              name="childrenAges"
              placeholder="7, 4"
              hint="Comma separated, leave empty if none"
            />
            <Field label="Currency" name="currency" defaultValue="USD" maxLength={3} />
            <Field
              label="Planning fee (optional)"
              name="fee"
              inputMode="decimal"
              hint="Shown to the client as a separate line"
            />
            <div className="sm:col-span-2">
              <Button type="submit">Create trip</Button>
            </div>
          </form>
        )}
      </Card>
    </div>
  );
}

export default function NewTripPage() {
  return (
    <Suspense>
      <NewTrip />
    </Suspense>
  );
}
