'use client';

import { useQuery } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useState, type FormEvent } from 'react';
import { AccessNotice } from '@/components/gate';
import { Alert, Button, Card, Field, Select } from '@/components/ui';
import { api, ApiError, call } from '@/lib/api';

export default function NewTopicPage() {
  const router = useRouter();
  const [error, setError] = useState<ApiError | null>(null);
  const cats = useQuery({
    queryKey: ['forum-cats'],
    queryFn: () => call(api.GET('/v1/community/categories')),
    retry: false,
  });
  if (cats.isError) return <AccessNotice error={cats.error} />;

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const f = new FormData(e.currentTarget);
    try {
      const r = await call(
        api.POST('/v1/community/topics', {
          body: {
            category: String(f.get('category')),
            title: String(f.get('title')),
            body: String(f.get('body')),
          },
        }),
      );
      router.push(`/community/t/${r.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err : null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Card title="New topic">
        <form onSubmit={onSubmit} className="flex flex-col gap-4">
          {error && <Alert>{error.message}</Alert>}
          <Select label="Category" name="category">
            {cats.data?.map((c) => (
              <option key={c.slug} value={c.slug}>
                {c.name}
              </option>
            ))}
          </Select>
          <Field
            label="Title"
            name="title"
            required
            minLength={5}
            maxLength={150}
            error={error?.fieldError('title')}
          />
          <div className="flex flex-col gap-1">
            <label htmlFor="body" className="text-sm font-medium">
              Message
            </label>
            <textarea
              id="body"
              name="body"
              rows={8}
              required
              maxLength={10000}
              className="rounded-md border border-gray-300 px-3 py-2"
            />
          </div>
          <p className="text-xs text-muted">Be kind and keep client details out of public posts.</p>
          <Button type="submit">Post topic</Button>
        </form>
      </Card>
    </div>
  );
}
