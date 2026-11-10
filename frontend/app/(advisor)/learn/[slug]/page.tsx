'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { use } from 'react';
import { AccessNotice } from '@/components/gate';
import { Alert, Card, StatusBadge } from '@/components/ui';
import { api, call } from '@/lib/api';

export default function CoursePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const q = useQuery({
    queryKey: ['course', slug],
    queryFn: () => call(api.GET('/v1/learning/courses/{slug}', { params: { path: { slug } } })),
    retry: false,
  });
  if (q.isPending) return <p className="text-muted">Loading…</p>;
  if (q.isError) return <AccessNotice error={q.error} />;
  const c = q.data;
  return (
    <div className="flex flex-col gap-6">
      <Link href="/learn" className="text-sm text-brand-700 underline">
        All courses
      </Link>
      <div>
        <h1 className="text-3xl font-normal tracking-tight">{c.title}</h1>
        <p className="mt-1 text-muted">{c.summary}</p>
      </div>
      {c.passed && (
        <Alert kind="success">
          You passed this course
          {c.quiz.bestScorePct !== null ? ` with ${c.quiz.bestScorePct}%` : ''}.
        </Alert>
      )}
      <Card title="Lessons">
        <ol className="flex flex-col divide-y divide-line">
          {c.lessons.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-3 py-2">
              <Link
                className="text-brand-700 underline-offset-4 hover:underline"
                href={`/learn/${slug}/lessons/${l.position}`}
              >
                {l.position}. {l.title}
              </Link>
              <span className="flex items-center gap-3 text-xs text-muted">
                {l.estMinutes} min {l.completed && <StatusBadge status="passed" />}
              </span>
            </li>
          ))}
        </ol>
      </Card>
      <Card title="Final quiz">
        <p className="text-sm text-muted">
          {c.quiz.questionCount} questions. Pass mark {c.passMarkPct}%. {c.quiz.attemptsLeftToday}{' '}
          attempts left today.
        </p>
        <div className="mt-3">
          {c.quiz.unlocked ? (
            <Link
              href={`/learn/${slug}/quiz`}
              className="inline-block inline-flex h-12 items-center rounded-full bg-accent-strong px-6 text-[15px] font-medium text-white hover:bg-accent-deep"
            >
              {c.passed ? 'Retake the quiz' : 'Take the quiz'}
            </Link>
          ) : (
            <p className="text-sm">Finish every lesson to unlock the quiz.</p>
          )}
        </div>
      </Card>
    </div>
  );
}
