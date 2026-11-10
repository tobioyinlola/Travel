'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert, Field } from '@/components/ui';
import { Thread } from '@/components/thread';
import { api, API_BASE_URL, ApiError, call, uploadFile } from '@/lib/api';

/** FR-TRV-06: ask the advisor a question from the same private link. */
export function Messages({
  token,
  advisorName,
  suggestedName,
}: {
  token: string;
  advisorName: string;
  suggestedName: string;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState(suggestedName);
  const [error, setError] = useState<string | null>(null);
  const key = ['traveler-thread', token];
  const q = useQuery({
    queryKey: key,
    queryFn: () =>
      call(api.GET('/v1/proposal-links/{token}/messages', { params: { path: { token } } })),
    refetchInterval: 20_000,
  });
  const send = useMutation({
    mutationFn: ({ body, ids }: { body: string; ids: string[] }) =>
      call(
        api.POST('/v1/proposal-links/{token}/messages', {
          params: { path: { token } },
          body: { name: name.trim(), body, ...(ids.length ? { attachmentIds: ids } : {}) },
        }),
      ),
    onSuccess: (data) => {
      setError(null);
      qc.setQueryData(key, data);
    },
    onError: (e) =>
      setError(
        e instanceof ApiError
          ? `${e.problem.title}. ${e.problem.detail ?? ''}`
          : 'Something went wrong',
      ),
  });

  return (
    <section aria-labelledby="msg-h" className="mt-8 rounded-[24px] bg-surface p-5 shadow-card">
      <h2 id="msg-h" className="text-lg">
        Questions for {advisorName}
      </h2>
      <p className="mb-3 text-sm text-muted">
        Your message goes to {advisorName}, who will reply here and by email.
      </p>
      {error && <Alert>{error}</Alert>}
      <Thread
        items={q.data?.items ?? []}
        mine="traveler"
        busy={send.isPending || name.trim().length < 2}
        onSend={(b, ids) => send.mutateAsync({ body: b, ids }).catch(() => undefined)}
        onUpload={(f) => uploadFile(`/v1/proposal-links/${token}/attachments`, f)}
        fileHref={(id) => `${API_BASE_URL}/v1/proposal-links/${token}/attachments/${id}`}
        placeholder="Is breakfast included? Can we add a night?"
      >
        <Field
          label="Your name"
          name="name"
          autoComplete="name"
          required
          minLength={2}
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
      </Thread>
    </section>
  );
}
