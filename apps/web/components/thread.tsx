'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Button, Empty, TextArea } from '@/components/ui';

export type ThreadMessage = {
  id: string;
  sender: 'traveler' | 'advisor';
  senderName: string;
  body: string;
  createdAt: string;
  read: boolean;
};

/** A plain two-sided conversation: the same view for the traveler and the advisor. */
export function Thread({
  items,
  mine,
  busy,
  onSend,
  placeholder,
  children,
}: {
  items: ThreadMessage[];
  mine: 'traveler' | 'advisor';
  busy: boolean;
  onSend: (body: string) => Promise<unknown>;
  placeholder: string;
  children?: React.ReactNode;
}) {
  const [text, setText] = useState('');
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => end.current?.scrollIntoView?.({ block: 'nearest' }), [items.length]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    await onSend(body);
    setText('');
  }

  return (
    <div className="flex flex-col gap-3">
      {items.length === 0 ? (
        <Empty>No messages yet.</Empty>
      ) : (
        <ul className="flex max-h-96 flex-col gap-2 overflow-y-auto text-sm" aria-live="polite">
          {items.map((m) => (
            <li
              key={m.id}
              className={`max-w-[85%] rounded-[18px] px-4 py-3 ${
                m.sender === mine ? 'self-end bg-accent-soft' : 'self-start bg-canvas'
              }`}
            >
              <span className="block text-xs text-ink">
                {m.senderName} · {new Date(m.createdAt).toLocaleString()}
              </span>
              <span className="mt-1 block whitespace-pre-wrap">{m.body}</span>
            </li>
          ))}
          <li ref={end} aria-hidden />
        </ul>
      )}
      {children}
      <form onSubmit={submit} className="flex flex-col gap-2">
        <TextArea
          label="Message"
          name="message"
          rows={3}
          maxLength={4000}
          required
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={placeholder}
        />
        <Button type="submit" disabled={busy || !text.trim()}>
          Send message
        </Button>
      </form>
    </div>
  );
}
