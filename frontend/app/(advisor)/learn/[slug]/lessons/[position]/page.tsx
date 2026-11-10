'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { use } from 'react';
import Markdown from 'react-markdown';
import { AccessNotice } from '@/components/gate';
import { Button } from '@/components/ui';
import { api, call } from '@/lib/api';

export default function LessonPage({
  params,
}: {
  params: Promise<{ slug: string; position: string }>;
}) {
  const { slug, position } = use(params);
  const pos = Number(position);
  const router = useRouter();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['lesson', slug, pos],
    queryFn: () =>
      call(
        api.GET('/v1/learning/courses/{slug}/lessons/{position}', {
          params: { path: { slug, position: pos } },
        }),
      ),
    retry: false,
  });
  const complete = useMutation({
    mutationFn: () =>
      call(
        api.POST('/v1/learning/courses/{slug}/lessons/{position}/complete', {
          params: { path: { slug, position: pos } },
        }),
      ),
    onSuccess: async () => {
      await qc.invalidateQueries({ queryKey: ['course', slug] });
      router.push(
        pos < (q.data?.lessonCount ?? 0) ? `/learn/${slug}/lessons/${pos + 1}` : `/learn/${slug}`,
      );
    },
  });
  if (q.isPending) return <p className="text-muted">Loading…</p>;
  if (q.isError) return <AccessNotice error={q.error} />;
  const l = q.data;
  return (
    <article className="mx-auto flex max-w-2xl flex-col gap-6">
      <Link href={`/learn/${slug}`} className="text-sm text-brand-700 underline">
        Back to course
      </Link>
      <header>
        <p className="text-sm text-muted">
          Lesson {l.position} of {l.lessonCount} · {l.estMinutes} min
        </p>
        <h1 className="text-3xl font-normal tracking-tight">{l.title}</h1>
      </header>
      {/* react-markdown renders no raw HTML, so lesson content cannot inject markup. */}
      <div className="prose-lesson flex flex-col gap-3 leading-relaxed [&_h2]:mt-4 [&_h2]:text-lg [&_h2]:font-medium [&_li]:ml-5 [&_ol]:list-decimal [&_ul]:list-disc">
        <Markdown>{l.bodyMarkdown}</Markdown>
      </div>
      <Button onClick={() => complete.mutate()} disabled={complete.isPending}>
        {pos < l.lessonCount ? 'Mark complete and continue' : 'Mark complete'}
      </Button>
    </article>
  );
}
