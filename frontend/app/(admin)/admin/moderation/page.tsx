'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { Alert, Button, Card } from '@/components/ui';
import { api, call } from '@/lib/api';

/** FR-CMT-01: reported community content, grouped per post. */
export default function ModerationPage() {
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['reports'],
    queryFn: () => call(api.GET('/v1/community/moderation/reports')),
  });
  const act = useMutation({
    mutationFn: (v: {
      type: 'topic' | 'post';
      id: string;
      action: 'hide' | 'dismiss' | 'unhide';
    }) =>
      call(
        api.POST('/v1/community/moderation/{type}/{id}', {
          params: { path: { type: v.type, id: v.id } },
          body: { action: v.action },
        }),
      ),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reports'] }),
  });
  if (q.isPending) return <p className="text-muted">Loading…</p>;
  if (q.isError) return <Alert>Could not load reports.</Alert>;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-3xl font-normal tracking-tight">Moderation</h1>
      {q.data.length === 0 && <p className="text-muted">Nothing to review.</p>}
      {q.data.map((r) => (
        <Card key={r.targetId}>
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span>
              {r.targetType === 'topic' ? 'Topic' : 'Reply'} by <strong>{r.authorName}</strong> in{' '}
              <Link className="text-brand-700 underline" href={`/community/t/${r.topicId}`}>
                {r.topicTitle}
              </Link>
            </span>
            <span className="text-muted">
              {r.reports} reports: {[...new Set(r.reasons)].join(', ').replace(/_/g, ' ')}
              {r.hidden && ' · hidden'}
            </span>
          </div>
          <p className="mt-3 whitespace-pre-wrap break-words rounded-[18px] bg-canvas p-3 text-sm">
            {r.body}
          </p>
          <div className="mt-3 flex gap-3">
            <Button
              variant="danger"
              onClick={() => act.mutate({ type: r.targetType, id: r.targetId, action: 'hide' })}
            >
              Hide
            </Button>
            <Button
              variant="secondary"
              onClick={async () => {
                await act.mutateAsync({ type: r.targetType, id: r.targetId, action: 'dismiss' });
                if (r.hidden)
                  await act.mutateAsync({ type: r.targetType, id: r.targetId, action: 'unhide' });
              }}
            >
              Dismiss and restore
            </Button>
          </div>
        </Card>
      ))}
    </div>
  );
}
