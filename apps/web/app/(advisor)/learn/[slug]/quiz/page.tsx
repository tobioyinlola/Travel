'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { use, useState, type FormEvent } from 'react';
import { AccessNotice } from '@/components/gate';
import { Alert, Button, Card } from '@/components/ui';
import { api, ApiError, call } from '@/lib/api';

export default function QuizPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = use(params);
  const qc = useQueryClient();
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const q = useQuery({
    queryKey: ['quiz', slug],
    queryFn: () =>
      call(api.GET('/v1/learning/courses/{slug}/quiz', { params: { path: { slug } } })),
    retry: false,
  });
  const submit = useMutation({
    mutationFn: () =>
      call(
        api.POST('/v1/learning/courses/{slug}/quiz/attempts', {
          params: { path: { slug } },
          body: { answers },
        }),
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['course', slug] });
      void qc.invalidateQueries({ queryKey: ['me'] });
      window.scrollTo({ top: 0 });
    },
  });
  if (q.isPending) return <p className="text-muted">Loading…</p>;
  if (q.isError) return <AccessNotice error={q.error} />;
  const result = submit.data;
  const wrong = new Set(result?.incorrect ?? []);
  const review = new Map(result?.review?.map((r) => [r.questionId, r]) ?? []);

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    submit.mutate();
  }

  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <Link href={`/learn/${slug}`} className="text-sm text-brand-700 underline">
        Back to course
      </Link>
      <h1 className="text-2xl font-semibold">Final quiz</h1>
      {submit.error && (
        <Alert>
          {submit.error instanceof ApiError ? submit.error.message : 'Something went wrong'}
        </Alert>
      )}
      {result && (
        <Alert kind={result.passed ? 'success' : 'error'}>
          You scored {result.scorePct}% (pass mark {result.passMarkPct}%).{' '}
          {result.passed
            ? result.bookingUnlocked
              ? 'Booking is now unlocked.'
              : 'Well done.'
            : `${result.incorrect.length} answers were wrong. Review the lessons and try again.`}
        </Alert>
      )}
      <form onSubmit={onSubmit} className="flex flex-col gap-4">
        {q.data.questions.map((question, i) => (
          <Card key={question.id}>
            <fieldset aria-invalid={wrong.has(question.id)}>
              <legend className="font-medium">
                {i + 1}. {question.prompt}
              </legend>
              <div className="mt-3 flex flex-col gap-2">
                {question.options.map((o) => (
                  <label key={o.id} className="flex items-start gap-2">
                    <input
                      type="radio"
                      name={question.id}
                      value={o.id}
                      required
                      disabled={result?.passed}
                      checked={answers[question.id] === o.id}
                      onChange={() => setAnswers({ ...answers, [question.id]: o.id })}
                    />
                    <span>{o.text}</span>
                  </label>
                ))}
              </div>
              {wrong.has(question.id) && <p className="mt-2 text-sm text-red-700">Not quite.</p>}
              {review.get(question.id) && (
                <p className="mt-2 text-sm text-muted">{review.get(question.id)!.explanation}</p>
              )}
            </fieldset>
          </Card>
        ))}
        {!result?.passed && (
          <Button type="submit" disabled={submit.isPending || q.data.attemptsLeftToday === 0}>
            Submit answers ({q.data.attemptsLeftToday} attempts left today)
          </Button>
        )}
      </form>
    </div>
  );
}
