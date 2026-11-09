export interface QuizQuestion {
  id: string;
  correctOption: string;
  explanation: string;
}

/** Score as a whole percentage (rounded down, so 79.9% never passes an 80% mark). */
export function scoreQuiz(
  questions: QuizQuestion[],
  answers: Record<string, string>,
  passMarkPct: number,
) {
  if (questions.length === 0) throw new Error('A quiz needs questions');
  const incorrect = questions.filter((q) => answers[q.id] !== q.correctOption).map((q) => q.id);
  const correct = questions.length - incorrect.length;
  const scorePct = Math.floor((correct * 100) / questions.length);
  return { scorePct, passed: scorePct >= passMarkPct, incorrect };
}
