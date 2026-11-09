'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { use, useState, type FormEvent } from 'react';
import { AccessNotice } from '@/components/gate';
import { Alert, Button, Card } from '@/components/ui';
import { api, ApiError, call } from '@/lib/api';

type Post = {
  id: string;
  authorName: string;
  body: string;
  hidden: boolean;
  createdAt: string;
  editedAt: string | null;
  mine: boolean;
};

export default function TopicPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const q = useQuery({
    queryKey: ['topic', id],
    queryFn: () => call(api.GET('/v1/community/topics/{id}', { params: { path: { id } } })),
    retry: false,
  });
  const send = useMutation({
    mutationFn: () =>
      call(
        api.POST('/v1/community/topics/{id}/replies', {
          params: { path: { id } },
          body: { body: reply },
        }),
      ),
    onSuccess: () => {
      setReply('');
      return qc.invalidateQueries({ queryKey: ['topic', id] });
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Something went wrong'),
  });

  async function report(targetType: 'topic' | 'post', targetId: string) {
    setError(null);
    try {
      await call(
        api.POST('/v1/community/reports', { body: { targetType, targetId, reason: 'other' } }),
      );
      setNotice('Thanks. A moderator will take a look.');
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Something went wrong');
    }
  }

  if (q.isPending) return <p className="text-muted">Loading…</p>;
  if (q.isError) return <AccessNotice error={q.error} />;
  const t = q.data;

  const renderPost = (p: Post, kind: 'topic' | 'post') => (
    <Card key={p.id}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-muted">
        <span>
          <span className="font-medium text-ink">{p.authorName}</span> ·{' '}
          {new Date(p.createdAt).toLocaleString()}
          {p.editedAt && ' · edited'}
        </span>
        {!p.mine && (
          <button className="text-xs underline" onClick={() => report(kind, p.id)}>
            Report
          </button>
        )}
      </div>
      {p.hidden && <p className="mt-2 text-xs text-danger">Hidden from members</p>}
      {/* Plain text only: whitespace kept, no HTML or markdown rendering. */}
      <p className="mt-2 whitespace-pre-wrap break-words">{p.body}</p>
    </Card>
  );

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      <Link href="/community" className="text-sm text-brand-700 underline">
        Community
      </Link>
      <p className="text-sm text-muted">{t.categoryName}</p>
      <h1 className="text-3xl font-normal tracking-tight">{t.title}</h1>
      {error && <Alert>{error}</Alert>}
      {notice && <Alert kind="success">{notice}</Alert>}
      {renderPost(t.opening, 'topic')}
      {t.replies.map((p) => renderPost(p, 'post'))}
      {t.locked ? (
        <Alert kind="info">This topic is locked.</Alert>
      ) : (
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            setError(null);
            send.mutate();
          }}
          className="flex flex-col gap-2"
        >
          <label htmlFor="reply" className="text-sm font-medium">
            Your reply
          </label>
          <textarea
            id="reply"
            value={reply}
            onChange={(e) => setReply(e.target.value)}
            rows={4}
            required
            maxLength={10000}
            className="rounded-[18px] bg-canvas px-4 py-3 outline-none focus:ring-2 focus:ring-accent"
          />
          <Button type="submit" disabled={send.isPending || !reply.trim()}>
            Reply
          </Button>
        </form>
      )}
    </div>
  );
}
