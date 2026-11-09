'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { useState } from 'react';
import { FilterBar } from '@/components/filter-bar';
import { AccessNotice } from '@/components/gate';
import {
  Avatar,
  Button,
  ButtonLink,
  Empty,
  ListRow,
  PageHeader,
  StatusBadge,
} from '@/components/ui';
import { api, call } from '@/lib/api';

export default function ClientsPage() {
  const [q, setQ] = useState<string | undefined>();
  const [filters, setFilters] = useState<Record<string, string | undefined>>({});
  const status = (filters.status as 'active' | 'archived' | undefined) ?? 'active';
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
      <PageHeader
        title="Clients"
        subtitle="Everyone you plan for, with their preferences and trips"
        actions={
          <FilterBar
            filters={[
              {
                key: 'status',
                label: 'Status',
                options: [
                  { value: 'active', label: 'Active' },
                  { value: 'archived', label: 'Archived' },
                ],
              },
            ]}
            values={filters}
            onChange={setFilters}
            search={q}
            onSearch={setQ}
            searchLabel="Search by name or email"
          >
            <ButtonLink href="/clients/new" icon={UserPlus}>
              Add client
            </ButtonLink>
          </FilterBar>
        }
      />
      {list.isPending ? (
        <p className="text-muted">Loading…</p>
      ) : rows.length === 0 ? (
        <Empty>
          {q
            ? 'No clients match.'
            : status === 'archived'
              ? 'No archived clients.'
              : 'No clients yet. Add your first client to start planning.'}
        </Empty>
      ) : (
        <ul className="grid gap-2 lg:grid-cols-2">
          {rows.map((c) => (
            <li key={c.id}>
              <ListRow
                href={`/clients/${c.id}`}
                leading={<Avatar name={`${c.firstName} ${c.lastName}`} size="lg" />}
                title={`${c.firstName} ${c.lastName}`}
                subtitle={
                  [c.email, c.phone, c.homeCity].filter(Boolean).join(' · ') || 'No contact details'
                }
                trailing={c.status !== 'active' ? <StatusBadge status={c.status} /> : undefined}
              />
            </li>
          ))}
        </ul>
      )}
      {list.hasNextPage && (
        <Button variant="secondary" onClick={() => list.fetchNextPage()} className="self-center">
          Load more
        </Button>
      )}
    </div>
  );
}
