'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { AccessNotice } from '@/components/gate';
import { Alert, Button, Card, Empty, PageHeader, StatusBadge } from '@/components/ui';
import { api, ApiError, call } from '@/lib/api';

/** Bookings waiting on a supplier for too long. Support can retry them. */
export default function StuckBookingsPage() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['stuck-bookings'],
    queryFn: () => call(api.GET('/v1/support/bookings/stuck', { params: { query: {} } })),
    refetchInterval: 10_000,
    retry: false,
  });
  const retry = useMutation({
    mutationFn: (id: string) =>
      call(api.POST('/v1/support/bookings/{id}/retry', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stuck-bookings'] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Something went wrong'),
  });

  if (q.isPending) return <p className="text-muted">Loading…</p>;
  if (q.isError) return <AccessNotice error={q.error} />;
  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Stuck bookings"
        subtitle="Bookings still waiting on a supplier. Retrying asks the supplier again."
      />
      {error && <Alert>{error}</Alert>}
      {q.data.items.length === 0 ? (
        <Empty>Nothing is stuck right now.</Empty>
      ) : (
        <div className="flex flex-col gap-3">
          {q.data.items.map((b) => (
            <Card key={b.id} title={b.tripTitle}>
              <p className="text-sm text-muted">
                Waiting since {new Date(b.pendingSince).toLocaleString()}
              </p>
              <ul className="mt-3 flex flex-col gap-2 text-sm">
                {b.lines.map((l) => (
                  <li
                    key={l.id}
                    className="flex items-center justify-between rounded-[14px] bg-canvas px-4 py-3"
                  >
                    <span>
                      {l.propertyName} · {l.supplier} · {l.attempts} attempt
                      {l.attempts === 1 ? '' : 's'}
                    </span>
                    <StatusBadge status={l.status} />
                  </li>
                ))}
              </ul>
              <div className="mt-3">
                <Button onClick={() => retry.mutate(b.id)} disabled={retry.isPending}>
                  Retry
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
