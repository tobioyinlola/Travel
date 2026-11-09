'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Button, Card, StatusBadge } from '@/components/ui';
import { api, ApiError, call } from '@/lib/api';

/** FR-CRM-08 / NFR-10: verify the requester, then export or erase within 30 days. */
export default function PrivacyPage() {
  const qc = useQueryClient();
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const q = useQuery({
    queryKey: ['privacy'],
    queryFn: () => call(api.GET('/v1/admin/privacy-requests')),
    refetchInterval: 5000,
  });
  const decide = useMutation({
    mutationFn: ({ id, verdict }: { id: string; verdict: 'verify' | 'reject' }) => {
      const body = { note: notes[id] ?? '' };
      return call(
        verdict === 'verify'
          ? api.POST('/v1/admin/privacy-requests/{id}/verify', { params: { path: { id } }, body })
          : api.POST('/v1/admin/privacy-requests/{id}/reject', { params: { path: { id } }, body }),
      );
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['privacy'] }),
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Something went wrong'),
  });

  async function download(id: string) {
    const data = await call(
      api.GET('/v1/admin/privacy-requests/{id}/export', { params: { path: { id } } }),
    );
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
    );
    const a = document.createElement('a');
    a.href = url;
    a.download = `client-data-${id}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  if (q.isPending) return <p className="text-muted">Loading…</p>;
  if (q.isError) return <Alert>Could not load privacy requests.</Alert>;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Privacy requests</h1>
      {error && <Alert>{error}</Alert>}
      {q.data.length === 0 && <p className="text-muted">No requests.</p>}
      {q.data.map((r) => (
        <Card key={r.id}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-medium">
              {r.kind === 'export' ? 'Data export' : 'Deletion'} for {r.clientName}
            </span>
            <span className="flex items-center gap-2 text-sm text-muted">
              <StatusBadge status={r.status} /> due {new Date(r.dueAt).toLocaleDateString()}
            </span>
          </div>
          {r.requesterNote && <p className="mt-2 text-sm">Advisor note: {r.requesterNote}</p>}
          {r.status === 'requested' && (
            <div className="mt-3 flex flex-col gap-2">
              <label htmlFor={`n-${r.id}`} className="text-sm font-medium">
                How you verified the requester (required)
              </label>
              <textarea
                id={`n-${r.id}`}
                rows={2}
                className="rounded-md border border-gray-300 px-3 py-2"
                value={notes[r.id] ?? ''}
                onChange={(e) => setNotes({ ...notes, [r.id]: e.target.value })}
              />
              <div className="flex gap-3">
                <Button onClick={() => decide.mutate({ id: r.id, verdict: 'verify' })}>
                  Verified: {r.kind === 'export' ? 'produce export' : 'erase data'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => decide.mutate({ id: r.id, verdict: 'reject' })}
                >
                  Reject
                </Button>
              </div>
            </div>
          )}
          {r.hasExport && (
            <Button className="mt-3" variant="secondary" onClick={() => download(r.id)}>
              Download export
            </Button>
          )}
        </Card>
      ))}
    </div>
  );
}
