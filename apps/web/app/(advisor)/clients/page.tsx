'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { AccessNotice } from '@/components/gate';
import { Button, Field } from '@/components/ui';
import { api, call } from '@/lib/api';

export default function ClientsPage() {
  const [q, setQ] = useState<string | undefined>();
  const [status, setStatus] = useState<'active' | 'archived'>('active');
  const list = useInfiniteQuery({
    queryKey: ['clients', q, status],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      call(
        api.GET('/v1/clients', {
          params: {
            query: {
              limit: 25,
              status,
              ...(q ? { q } : {}),
              ...(pageParam ? { cursor: pageParam } : {}),
            },
          },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    retry: false,
  });
  if (list.isError) return <AccessNotice error={list.error} />;
  const rows = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Clients</h1>
        <Link
          href="/clients/new"
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          Add client
        </Link>
      </div>
      <form
        role="search"
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e: FormEvent<HTMLFormElement>) => {
          e.preventDefault();
          setQ(String(new FormData(e.currentTarget).get('q') ?? '').trim() || undefined);
        }}
      >
        <div className="min-w-60 flex-1">
          <Field label="Search by name or email" name="q" type="search" />
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={status === 'archived'}
            onChange={(e) => setStatus(e.target.checked ? 'archived' : 'active')}
          />{' '}
          Show archived
        </label>
      </form>
      <div className="overflow-x-auto rounded-lg border border-gray-200 bg-surface">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Your clients</caption>
          <thead className="border-b border-gray-200 bg-gray-50">
            <tr>
              <th className="px-4 py-2">Name</th>
              <th className="px-4 py-2">Email</th>
              <th className="px-4 py-2">Phone</th>
              <th className="px-4 py-2">City</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-b border-gray-100">
                <td className="px-4 py-2">
                  <Link className="text-brand-700 underline" href={`/clients/${c.id}`}>
                    {c.firstName} {c.lastName}
                  </Link>
                </td>
                <td className="px-4 py-2">{c.email ?? '—'}</td>
                <td className="px-4 py-2">{c.phone ?? '—'}</td>
                <td className="px-4 py-2">{c.homeCity ?? '—'}</td>
              </tr>
            ))}
            {list.isSuccess && rows.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-muted">
                  {q ? 'No matches' : 'No clients yet'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      {list.hasNextPage && (
        <Button variant="secondary" onClick={() => list.fetchNextPage()}>
          Load more
        </Button>
      )}
    </div>
  );
}
