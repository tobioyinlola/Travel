import { describe, expect, it } from 'vitest';
import { scoreQuiz } from './quiz.js';

const qs = ['q1', 'q2', 'q3', 'q4', 'q5'].map((id) => ({
  id,
  correctOption: 'a',
  explanation: '',
}));

describe('quiz scoring', () => {
  it('passes at exactly the pass mark', () => {
    const r = scoreQuiz(qs, { q1: 'a', q2: 'a', q3: 'a', q4: 'a', q5: 'b' }, 80);
    expect(r).toEqual({ scorePct: 80, passed: true, incorrect: ['q5'] });
  });
  it('rounds down and treats missing answers as wrong', () => {
    const three = qs.slice(0, 3);
    expect(scoreQuiz(three, { q1: 'a', q2: 'a' }, 67)).toMatchObject({
      scorePct: 66,
      passed: false,
      incorrect: ['q3'],
    });
  });
  it('ignores answers to questions that are not in the quiz', () => {
    expect(scoreQuiz(qs, { q1: 'a', zzz: 'a' }, 80).scorePct).toBe(20);
  });
});
