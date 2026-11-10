'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Button, PageHeader, StatusBadge } from '@/components/ui';
import { api, call } from '@/lib/api';

const STATUSES = [
  'under_review',
  'applied',
  'approved',
  'active',
  'rejected',
  'suspended',
  'offboarded',
] as const;
type Status = (typeof STATUSES)[number];

/** FR-ADM-01: review queue, oldest first. */
export default function ApplicationsPage() {
  const [status, setStatus] = useState<Status | ''>('under_review');
  const q = useInfiniteQuery({
    queryKey: ['admin-applications', status],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      call(
        api.GET('/v1/admin/applications', {
          params: {
            query: {
              limit: 25,
              ...(status ? { status } : {}),
              ...(pageParam ? { cursor: pageParam } : {}),
            },
          },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Applications"
        subtitle="Review applicants once identity and agreement checks are complete"
      />
      <nav aria-label="Filter by status" className="scrollbar-none flex gap-2 overflow-x-auto">
        {(
          [
            ['', 'All'],
            ...STATUSES.map((x) => [x, x.charAt(0).toUpperCase() + x.slice(1).replace(/_/g, ' ')]),
          ] as Array<[Status | '', string]>
        ).map(([value, label]) => (
          <button
            key={value || 'all'}
            onClick={() => setStatus(value)}
            aria-pressed={status === value}
            className={`inline-flex h-12 shrink-0 items-center rounded-full px-5 text-sm ${status === value ? 'bg-ink text-white' : 'bg-surface text-ink hover:bg-white/70'}`}
          >
            {label}
          </button>
        ))}
      </nav>
      <div className="overflow-x-auto rounded-[28px] bg-surface p-3">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Advisor applications</caption>
          <thead className="text-xs text-muted">
            <tr>
              <th className="px-4 py-3 font-normal">Applicant</th>
              <th className="px-4 py-3 font-normal">Country</th>
              <th className="px-4 py-3 font-normal">Submitted</th>
              <th className="px-4 py-3 font-normal">Identity</th>
              <th className="px-4 py-3 font-normal">Agreement</th>
              <th className="px-4 py-3 font-normal">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line">
                <td className="px-4 py-2">
                  <Link className="text-brand-700 underline" href={`/admin/applications/${r.id}`}>
                    {r.legalName}
                  </Link>
                  {r.acceptedAt && r.status === 'under_review' && (
                    <span className="ml-2 text-xs text-muted">accepted, awaiting payment</span>
                  )}
                </td>
                <td className="px-4 py-2">{r.country}</td>
                <td className="px-4 py-2">{new Date(r.submittedAt).toLocaleDateString()}</td>
                <td className="px-4 py-2">
                  <StatusBadge status={r.kycStatus} />
                </td>
                <td className="px-4 py-2">
                  <StatusBadge status={r.agreementStatus} />
                </td>
                <td className="px-4 py-2">
                  <StatusBadge status={r.status} />
                </td>
              </tr>
            ))}
            {!q.isPending && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-muted">
                  No applications
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {q.hasNextPage && (
        <Button variant="secondary" onClick={() => q.fetchNextPage()}>
          Load more
        </Button>
      )}
    </div>
  );
}
