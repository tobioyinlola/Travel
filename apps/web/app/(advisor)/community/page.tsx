'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Lock, MessagesSquare, Plus } from 'lucide-react';
import { useState } from 'react';
import { FilterBar } from '@/components/filter-bar';
import { AccessNotice } from '@/components/gate';
import { Button, ButtonLink, Empty, ListRow, PageHeader } from '@/components/ui';
import { api, call } from '@/lib/api';

export default function CommunityPage() {
  const [category, setCategory] = useState<string | undefined>();
  const [q, setQ] = useState<string | undefined>();
  const cats = useQuery({
    queryKey: ['forum-cats'],
    queryFn: () => call(api.GET('/v1/community/categories')),
    retry: false,
  });
  const topics = useInfiniteQuery({
    queryKey: ['topics', category, q],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      call(
        api.GET('/v1/community/topics', {
          params: {
            query: {
              limit: 20,
              ...(category ? { category } : {}),
              ...(q && q.length >= 2 ? { q } : {}),
              ...(pageParam ? { cursor: pageParam } : {}),
            },
          },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: cats.isSuccess,
  });
  if (cats.isError) return <AccessNotice error={cats.error} />;
  const rows = topics.data?.pages.flatMap((p) => p.items) ?? [];
  const date = (s: string) =>
    new Date(s).toLocaleDateString('en', { month: 'short', day: 'numeric' });

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        title="Community"
        subtitle="Ask, share and learn with other advisors"
        actions={
          <FilterBar
            filters={[]}
            values={{}}
            onChange={() => undefined}
            search={q}
            onSearch={setQ}
            searchLabel="Search topics and replies"
          >
            <ButtonLink href="/community/new" icon={Plus}>
              New topic
            </ButtonLink>
          </FilterBar>
        }
      />
      <nav aria-label="Categories" className="scrollbar-none flex gap-2 overflow-x-auto">
        {[
          { slug: undefined, name: 'All topics', topicCount: undefined as number | undefined },
          ...(cats.data ?? []),
        ].map((c) => {
          const active = category === c.slug;
          return (
            <button
              key={c.slug ?? 'all'}
              onClick={() => setCategory(c.slug)}
              aria-pressed={active}
              className={`inline-flex h-12 shrink-0 items-center gap-2 rounded-full px-5 text-sm ${active ? 'bg-ink text-white' : 'bg-surface text-ink hover:bg-white/70'}`}
            >
              {c.name}
              {c.topicCount !== undefined && (
                <span className={active ? 'text-white/70' : 'text-muted'}>{c.topicCount}</span>
              )}
            </button>
          );
        })}
      </nav>
      {q && <p className="text-sm text-muted">Results for “{q}”</p>}
      {topics.isSuccess && rows.length === 0 ? (
        <Empty>No topics yet. Start the conversation.</Empty>
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((t) => (
            <li key={t.id}>
              <ListRow
                href={`/community/t/${t.id}`}
                icon={t.locked ? Lock : MessagesSquare}
                title={t.title}
                subtitle={`${t.authorName} · ${t.replyCount} ${t.replyCount === 1 ? 'reply' : 'replies'} · ${date(t.lastActivityAt)}${t.hidden ? ' · hidden' : ''}`}
              />
            </li>
          ))}
        </ul>
      )}
      {topics.hasNextPage && (
        <Button variant="secondary" onClick={() => topics.fetchNextPage()} className="self-center">
          Load more
        </Button>
      )}
    </div>
  );
}
