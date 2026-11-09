'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import { AccessNotice } from '@/components/gate';
import { Card, StatusBadge } from '@/components/ui';
import { api, call } from '@/lib/api';

export default function LearnPage() {
  const q = useQuery({
    queryKey: ['courses'],
    queryFn: () => call(api.GET('/v1/learning/courses')),
    retry: false,
  });
  if (q.isPending) return <p className="text-muted">Loading…</p>;
  if (q.isError) return <AccessNotice error={q.error} />;
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">Learn</h1>
      <ul className="grid gap-4 sm:grid-cols-2">
        {q.data.map((c) => (
          <li key={c.slug}>
            <Card>
              <div className="flex items-start justify-between gap-3">
                <Link
                  href={`/learn/${c.slug}`}
                  className="text-lg font-medium text-brand-700 underline-offset-4 hover:underline"
                >
                  {c.title}
                </Link>
                {c.passed ? (
                  <StatusBadge status="passed" />
                ) : (
                  c.isEssentials && (
                    <span className="text-xs font-medium text-amber-900">Required to book</span>
                  )
                )}
              </div>
              <p className="mt-1 text-sm text-muted">{c.summary}</p>
              <div
                className="mt-3"
                aria-label={`${c.lessonsCompleted} of ${c.lessonCount} lessons complete`}
              >
                <div className="h-2 w-full rounded-full bg-gray-200">
                  <div
                    className="h-2 rounded-full bg-brand-600"
                    style={{ width: `${(c.lessonsCompleted / Math.max(1, c.lessonCount)) * 100}%` }}
                  />
                </div>
                <p className="mt-1 text-xs text-muted">
                  {c.lessonsCompleted} of {c.lessonCount} lessons
                </p>
              </div>
            </Card>
          </li>
        ))}
      </ul>
    </div>
  );
}
