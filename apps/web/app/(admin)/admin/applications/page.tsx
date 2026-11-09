'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState } from 'react';
import { Button, Select, StatusBadge } from '@/components/ui';
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
      <div className="flex flex-wrap items-end justify-between gap-4">
        <h1 className="text-2xl font-semibold">Applications</h1>
        <Select
          label="Status"
          value={status}
          onChange={(e) => setStatus(e.target.value as Status | '')}
        >
          <option value="">All</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace(/_/g, ' ')}
            </option>
          ))}
        </Select>
      </div>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-surface">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Advisor applications</caption>
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="px-4 py-2">Applicant</th>
              <th className="px-4 py-2">Country</th>
              <th className="px-4 py-2">Submitted</th>
              <th className="px-4 py-2">Identity</th>
              <th className="px-4 py-2">Agreement</th>
              <th className="px-4 py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-gray-100">
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
