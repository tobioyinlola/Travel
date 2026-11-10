'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Paperclip, X } from 'lucide-react';
import { Alert, Button, Empty, ICON, IconButton, TextArea } from '@/components/ui';
import { ApiError, formatBytes, type UploadedFile } from '@/lib/api';

export type ThreadMessage = {
  id: string;
  sender: 'traveler' | 'advisor';
  senderName: string;
  body: string;
  createdAt: string;
  read: boolean;
  attachments: UploadedFile[];
};

/** A plain two-sided conversation: the same view for the traveler and the advisor. */
export function Thread({
  items,
  mine,
  busy,
  onSend,
  onUpload,
  fileHref,
  placeholder,
  children,
}: {
  items: ThreadMessage[];
  mine: 'traveler' | 'advisor';
  busy: boolean;
  onSend: (body: string, attachmentIds: string[]) => Promise<unknown>;
  onUpload: (file: File) => Promise<UploadedFile>;
  fileHref: (id: string) => string;
  placeholder: string;
  children?: React.ReactNode;
}) {
  const [text, setText] = useState('');
  const [files, setFiles] = useState<UploadedFile[]>([]);
  const [uploading, setUploading] = useState(false);
  const [fileError, setFileError] = useState<string | null>(null);
  const end = useRef<HTMLLIElement>(null);
  useEffect(() => end.current?.scrollIntoView?.({ block: 'nearest' }), [items.length]);

  async function submit(e: FormEvent) {
    e.preventDefault();
    const body = text.trim();
    if (!body) return;
    await onSend(
      body,
      files.map((f) => f.id),
    );
    setText('');
    setFiles([]);
  }

  async function pick(list: FileList | null) {
    if (!list?.length) return;
    setFileError(null);
    setUploading(true);
    try {
      for (const f of Array.from(list)) {
        if (files.length >= 5) break;
        const up = await onUpload(f);
        setFiles((cur) => [...cur, up]);
      }
    } catch (e) {
      setFileError(e instanceof ApiError ? e.problem.title : 'The file could not be uploaded');
    } finally {
      setUploading(false);
    }
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
              {m.attachments.length > 0 && (
                <span className="mt-2 flex flex-col gap-1">
                  {m.attachments.map((a) => (
                    <a
                      key={a.id}
                      href={fileHref(a.id)}
                      download={a.filename}
                      className="inline-flex items-center gap-2 underline"
                    >
                      <Paperclip {...ICON} size={14} aria-hidden />
                      {a.filename} ({formatBytes(a.sizeBytes)})
                    </a>
                  ))}
                </span>
              )}
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
        {fileError && <Alert>{fileError}</Alert>}
        {files.length > 0 && (
          <ul className="flex flex-wrap gap-2 text-sm">
            {files.map((f) => (
              <li key={f.id} className="flex items-center gap-1 rounded-full bg-canvas px-3 py-1">
                {f.filename}
                <IconButton
                  icon={X}
                  label={`Remove ${f.filename}`}
                  onClick={() => setFiles((cur) => cur.filter((x) => x.id !== f.id))}
                />
              </li>
            ))}
          </ul>
        )}
        <label className="inline-flex w-fit cursor-pointer items-center gap-2 text-sm underline">
          <Paperclip {...ICON} size={16} aria-hidden />
          {uploading ? 'Uploading…' : 'Attach a PDF or image (up to 5 MB)'}
          <input
            type="file"
            className="sr-only"
            accept="application/pdf,image/png,image/jpeg"
            multiple
            disabled={uploading || files.length >= 5}
            onChange={(e) => {
              void pick(e.target.files);
              e.target.value = '';
            }}
          />
        </label>
        <Button type="submit" disabled={busy || uploading || !text.trim()}>
          Send message
        </Button>
      </form>
    </div>
  );
}
