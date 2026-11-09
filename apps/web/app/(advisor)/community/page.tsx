'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { AccessNotice } from '@/components/gate';
import { Button, Field } from '@/components/ui';
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
              ...(q ? { q } : {}),
              ...(pageParam ? { cursor: pageParam } : {}),
            },
          },
        }),
      ),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    enabled: cats.isSuccess,
  });
  if (cats.isError) return <AccessNotice error={cats.error} />;

  function onSearch(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const v = String(new FormData(e.currentTarget).get('q') ?? '').trim();
    setQ(v.length >= 2 ? v : undefined);
  }
  const rows = topics.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-semibold">Community</h1>
        <Link
          href="/community/new"
          className="rounded-md bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700"
        >
          New topic
        </Link>
      </div>
      <form onSubmit={onSearch} role="search" className="flex items-end gap-3">
        <div className="flex-1">
          <Field label="Search topics and replies" name="q" type="search" />
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>
      <div className="grid gap-6 md:grid-cols-[220px_1fr]">
        <nav aria-label="Categories">
          <ul className="flex flex-col gap-1 text-sm">
            <li>
              <button
                className={`text-left ${!category ? 'font-semibold' : 'text-brand-700 underline'}`}
                onClick={() => setCategory(undefined)}
              >
                All topics
              </button>
            </li>
            {cats.data?.map((c) => (
              <li key={c.slug}>
                <button
                  className={`text-left ${category === c.slug ? 'font-semibold' : 'text-brand-700 underline'}`}
                  onClick={() => setCategory(c.slug)}
                >
                  {c.name} <span className="text-muted">({c.topicCount})</span>
                </button>
              </li>
            ))}
          </ul>
        </nav>
        <section aria-label="Topics">
          {q && <p className="mb-3 text-sm text-muted">Results for “{q}”</p>}
          <ul className="flex flex-col divide-y divide-gray-200 rounded-lg border border-gray-200 bg-surface">
            {rows.map((t) => (
              <li
                key={t.id}
                className="flex flex-wrap items-center justify-between gap-2 px-4 py-3"
              >
                <div>
                  <Link
                    href={`/community/t/${t.id}`}
                    className="font-medium text-brand-700 underline-offset-4 hover:underline"
                  >
                    {t.title}
                  </Link>
                  {t.locked && <span className="ml-2 text-xs text-muted">locked</span>}
                  {t.hidden && <span className="ml-2 text-xs text-red-700">hidden</span>}
                  <p className="text-xs text-muted">by {t.authorName}</p>
                </div>
                <span className="text-xs text-muted">
                  {t.replyCount} replies · {new Date(t.lastActivityAt).toLocaleDateString()}
                </span>
              </li>
            ))}
            {topics.isSuccess && rows.length === 0 && (
              <li className="px-4 py-6 text-center text-muted">No topics yet</li>
            )}
          </ul>
          {topics.hasNextPage && (
            <Button className="mt-4" variant="secondary" onClick={() => topics.fetchNextPage()}>
              Load more
            </Button>
          )}
        </section>
      </div>
    </div>
  );
}
