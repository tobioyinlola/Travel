'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Send, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { AccessNotice } from '@/components/gate';
import {
  Alert,
  Button,
  Card,
  Empty,
  ICON,
  IconButton,
  PageHeader,
  Select,
  StatusBadge,
  TextArea,
} from '@/components/ui';
import { api, ApiError, call } from '@/lib/api';

const errText = (e: unknown) =>
  e instanceof ApiError ? `${e.problem.title}. ${e.problem.detail ?? ''}` : 'Something went wrong';

const CONFIDENCE: Record<string, string> = {
  high: 'Well supported',
  medium: 'Partly supported',
  low: 'Weakly supported',
};

/** Ask questions, get drafts to review (never sent), see what was used and what could not be verified. */
export default function AssistantPage() {
  const qc = useQueryClient();
  const [error, setError] = useState<string | null>(null);
  const [clientId, setClientId] = useState('');
  const clients = useQuery({
    queryKey: ['clients-all'],
    queryFn: () => call(api.GET('/v1/clients', { params: { query: { limit: 100 } } })),
  });
  const settings = useQuery({
    queryKey: ['ai-settings'],
    queryFn: () => call(api.GET('/v1/ai/settings')),
    retry: false,
  });
  const drafts = useQuery({
    queryKey: ['ai-drafts'],
    queryFn: () => call(api.GET('/v1/ai/drafts')),
    enabled: settings.isSuccess,
  });
  const history = useQuery({
    queryKey: ['ai-history'],
    queryFn: () => call(api.GET('/v1/ai/history')),
    enabled: settings.isSuccess,
  });
  const onError = (e: unknown) => setError(errText(e));

  const ask = useMutation({
    mutationFn: (question: string) =>
      call(api.POST('/v1/ai/ask', { body: { question, ...(clientId ? { clientId } : {}) } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-history'] }),
    onError,
  });
  const draft = useMutation({
    mutationFn: (instruction: string) =>
      call(
        api.POST('/v1/ai/drafts', {
          body: { kind: 'client_message', instruction, ...(clientId ? { clientId } : {}) },
        }),
      ),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ['ai-drafts'] }),
        qc.invalidateQueries({ queryKey: ['ai-history'] }),
      ]),
    onError,
  });
  const decide = useMutation({
    mutationFn: (v: { id: string; approve: boolean; text?: string }) =>
      v.approve
        ? call(
            api.POST('/v1/ai/drafts/{id}/approve', {
              params: { path: { id: v.id } },
              body: v.text ? { text: v.text } : {},
            }),
          )
        : call(api.POST('/v1/ai/drafts/{id}/reject', { params: { path: { id: v.id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-drafts'] }),
    onError,
  });
  const saveSettings = useMutation({
    mutationFn: (b: { enabled: boolean; useClientNotes: boolean }) =>
      call(api.PUT('/v1/ai/settings', { body: b })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-settings'] }),
    onError,
  });
  const remove = useMutation({
    mutationFn: (id: string) =>
      call(api.DELETE('/v1/ai/history/{id}', { params: { path: { id } } })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ai-history'] }),
    onError,
  });

  if (settings.isPending) return <p className="text-muted">Loading…</p>;
  if (settings.isError) return <AccessNotice error={settings.error} />;
  const s = settings.data;

  function submit(kind: 'ask' | 'draft') {
    return (e: FormEvent<HTMLFormElement>) => {
      e.preventDefault();
      setError(null);
      const f = new FormData(e.currentTarget);
      const text = String(f.get('text')).trim();
      if (kind === 'ask') ask.mutate(text);
      else draft.mutate(text);
    };
  }

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Assistant"
        subtitle="Answers from your catalog, partner programs and client notes. It never contacts anyone: you decide what to send."
      />
      {error && <Alert>{error}</Alert>}
      {!s.enabled && (
        <Alert kind="info">The assistant is turned off. Switch it on below to use it.</Alert>
      )}

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="Ask a question">
          <form onSubmit={submit('ask')} className="flex flex-col gap-3">
            <Select
              label="About a client (optional)"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
            >
              <option value="">No client</option>
              {clients.data?.items.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.firstName} {c.lastName}
                </option>
              ))}
            </Select>
            <TextArea
              label="Your question"
              name="text"
              rows={3}
              required
              minLength={3}
              maxLength={1000}
              placeholder="Which Lisbon hotels have a pool and a spa?"
            />
            <Button type="submit" icon={Send} disabled={ask.isPending || !s.enabled}>
              Ask
            </Button>
          </form>
          {ask.data && (
            <div className="mt-4 flex flex-col gap-3 text-sm" aria-live="polite">
              <p className="text-base">{ask.data.answer}</p>
              <p className="text-xs text-muted">Confidence: {CONFIDENCE[ask.data.confidence]}</p>
              {ask.data.flags.length > 0 && (
                <div className="rounded-[14px] bg-warn-soft p-3 text-warn">
                  <p className="flex items-center gap-2 font-medium">
                    <AlertTriangle {...ICON} size={16} aria-hidden /> Not verified: check before
                    telling a client
                  </p>
                  <ul className="mt-1 list-disc pl-5">
                    {ask.data.flags.map((f, i) => (
                      <li key={i}>
                        “{f.sentence}” <span className="opacity-80">({f.reason})</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {ask.data.sources.length > 0 && (
                <ol className="flex flex-col gap-1 text-xs text-muted">
                  {ask.data.sources.map((src) => (
                    <li key={src.id}>
                      {src.index ? `[${src.index}] ` : ''}
                      <strong className="font-medium text-ink">{src.title}</strong> · {src.type} ·{' '}
                      {src.snippet}
                    </li>
                  ))}
                </ol>
              )}
            </div>
          )}
        </Card>

        <Card title="Draft a message">
          <form onSubmit={submit('draft')} className="flex flex-col gap-3">
            <p className="text-sm text-muted">
              Drafts are for you to review and edit. Nothing is sent.
            </p>
            <TextArea
              label="What should it say?"
              name="text"
              rows={3}
              required
              minLength={3}
              maxLength={1000}
              placeholder="A note about quiet beachside boutique hotels"
            />
            <Button type="submit" variant="secondary" disabled={draft.isPending || !s.enabled}>
              Draft for review
            </Button>
          </form>
          <ul className="mt-4 flex flex-col gap-3">
            {drafts.data?.items.map((d) => (
              <DraftCard
                key={d.id}
                d={d}
                onDecide={(approve, text) =>
                  decide.mutate({ id: d.id, approve, ...(text ? { text } : {}) })
                }
              />
            ))}
            {drafts.data?.items.length === 0 && <Empty>No drafts yet.</Empty>}
          </ul>
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_360px]">
        <Card title="Your history">
          {history.data?.items.length ? (
            <ul className="flex flex-col gap-2 text-sm">
              {history.data.items.map((h) => (
                <li
                  key={h.id}
                  className="flex items-start justify-between gap-2 rounded-[14px] bg-canvas p-3"
                >
                  <span>
                    <span className="block">{h.prompt}</span>
                    <span className="block text-xs text-muted">
                      {h.kind === 'ask' ? 'Question' : 'Draft'} ·{' '}
                      {new Date(h.createdAt).toLocaleString()} ·{' '}
                      {h.toolCalls.map((c) => `${c.name}: ${c.resultCount}`).join(', ')} · {h.model}
                    </span>
                  </span>
                  <IconButton
                    icon={Trash2}
                    label="Delete this entry"
                    onClick={() => remove.mutate(h.id)}
                  />
                </li>
              ))}
            </ul>
          ) : (
            <Empty>
              Nothing yet. Every question and draft is listed here, and you can delete any of them.
            </Empty>
          )}
        </Card>
        <Card title="Settings">
          <div className="flex flex-col gap-3 text-sm">
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                checked={s.enabled}
                onChange={(e) =>
                  saveSettings.mutate({
                    enabled: e.target.checked,
                    useClientNotes: s.useClientNotes,
                  })
                }
              />
              Use the assistant
            </label>
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={s.useClientNotes}
                disabled={!s.enabled}
                onChange={(e) =>
                  saveSettings.mutate({ enabled: s.enabled, useClientNotes: e.target.checked })
                }
              />
              <span>
                Let it read my client notes and preferences
                <span className="block text-xs text-muted">
                  Only you can retrieve them. Turning this off removes them from the assistant right
                  away.
                </span>
              </span>
            </label>
          </div>
        </Card>
      </div>
    </div>
  );
}

type DraftView = {
  id: string;
  text: string;
  status: string;
  edited: boolean;
  instruction: string;
  flags: Array<{ sentence: string; reason: string }>;
  sources: Array<{ id: string; title: string; type: string }>;
};

function DraftCard({
  d,
  onDecide,
}: {
  d: DraftView;
  onDecide: (approve: boolean, text?: string) => void;
}) {
  const [text, setText] = useState(d.text);
  return (
    <li className="rounded-[18px] bg-canvas p-4 text-sm">
      <p className="mb-2 flex items-center justify-between gap-2">
        <span className="text-xs text-muted">{d.instruction}</span>
        <StatusBadge status={d.status === 'draft' ? 'pending' : d.status} />
      </p>
      {d.status === 'draft' ? (
        <>
          <TextArea
            label="Edit before approving"
            name={`t-${d.id}`}
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
          {d.flags.length > 0 && (
            <p className="mt-2 text-xs text-warn">
              {d.flags.length} claim(s) not verified: check prices, policies and perks before
              sending.
            </p>
          )}
          <p className="mt-1 text-xs text-muted">
            Sources: {d.sources.map((x) => x.title).join(', ') || 'none'}
          </p>
          <div className="mt-3 flex gap-2">
            <Button onClick={() => onDecide(true, text !== d.text ? text : undefined)}>
              Approve (does not send)
            </Button>
            <Button variant="ghost" onClick={() => onDecide(false)}>
              Reject
            </Button>
          </div>
        </>
      ) : (
        <p className="whitespace-pre-wrap">{d.text}</p>
      )}
    </li>
  );
}
