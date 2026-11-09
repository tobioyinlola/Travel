'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { AccessNotice } from '@/components/gate';
import { StatusBadge } from '@/components/ui';
import { api, call } from '@/lib/api';

export default function TripsPage() {
  const q = useQuery({
    queryKey: ['trips'],
    queryFn: () => call(api.GET('/v1/trips')),
    retry: false,
  });
  if (q.isPending) return <p className="text-muted">Loading…</p>;
  if (q.isError) return <AccessNotice error={q.error} />;
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Trips</h1>
        <Link
          href="/trips/new"
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          New trip
        </Link>
      </div>
      <ul className="flex flex-col divide-y divide-gray-200 rounded-lg border border-gray-200 bg-surface">
        {q.data.map((t) => (
          <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <Link
              href={`/trips/${t.id}`}
              className="font-medium text-brand-700 underline-offset-4 hover:underline"
            >
              {t.title}
            </Link>
            <span className="flex items-center gap-3 text-sm text-muted">
              {t.startDate} to {t.endDate} <StatusBadge status={t.status} />
            </span>
          </li>
        ))}
        {q.data.length === 0 && <li className="px-4 py-6 text-center text-muted">No trips yet</li>}
      </ul>
    </div>
  );
}
