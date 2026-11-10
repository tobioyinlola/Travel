import { HttpStatus, Injectable } from '@nestjs/common';
import { newId } from '../../shared-kernel/index.js';
import { IdentityApi, type AdvisorStatus, type AdvisorSummary } from '../../identity/index.js';
import { AuditWriter } from '../../../platform/audit/audit-writer.js';
import { Database } from '../../../platform/db/database.js';
import { ProblemException, problemType } from '../../../platform/http/problem.js';
import { scoreQuiz, type QuizQuestion } from '../domain/quiz.js';

/** Applicants may start learning while their application is reviewed (AC-01 allows either order). */
export const LEARNER_STATUSES: readonly AdvisorStatus[] = [
  'applied',
  'under_review',
  'approved',
  'active',
];
const MAX_ATTEMPTS_PER_DAY = 5;

const problem = (status: HttpStatus, slug: string, title: string, detail?: string) =>
  new ProblemException(status, problemType(slug), title, detail);

interface CourseRow {
  id: string;
  slug: string;
  title: string;
  summary: string;
  is_essentials: boolean;
  pass_mark_pct: number;
}

export interface CourseSummaryView {
  slug: string;
  title: string;
  summary: string;
  isEssentials: boolean;
  lessonCount: number;
  lessonsCompleted: number;
  passed: boolean;
}

export interface CourseView extends CourseSummaryView {
  passMarkPct: number;
  lessons: Array<{
    id: string;
    position: number;
    title: string;
    estMinutes: number;
    completed: boolean;
  }>;
  quiz: {
    questionCount: number;
    unlocked: boolean;
    attemptsToday: number;
    attemptsLeftToday: number;
    bestScorePct: number | null;
  };
}

export interface QuizResult {
  scorePct: number;
  passed: boolean;
  passMarkPct: number;
  /** Ids of questions answered wrongly. Correct answers are revealed only once the course is passed. */
  incorrect: string[];
  review: Array<{ questionId: string; correctOption: string; explanation: string }> | null;
  bookingUnlocked: boolean;
}

@Injectable()
export class CoursesService {
  constructor(
    private readonly db: Database,
    private readonly identity: IdentityApi,
    private readonly audit: AuditWriter,
  ) {}

  learner(userId: string): Promise<AdvisorSummary> {
    return this.identity.requireAdvisor(userId, LEARNER_STATUSES);
  }

  private async course(slug: string): Promise<CourseRow> {
    const [c] = await this.db.read<CourseRow>(
      'learning',
      'SELECT * FROM learning.courses WHERE slug = $1 AND published',
      [slug],
    );
    if (!c) throw problem(HttpStatus.NOT_FOUND, 'not-found', 'Course not found');
    return c;
  }

  async listCourses(advisorId: string): Promise<CourseSummaryView[]> {
    const rows = await this.db.read<
      CourseRow & { lesson_count: number; completed: number; passed: boolean }
    >(
      'learning',
      `SELECT c.*,
              (SELECT count(*)::int FROM learning.lessons l WHERE l.course_id = c.id) AS lesson_count,
              (SELECT count(*)::int FROM learning.lesson_progress p JOIN learning.lessons l ON l.id = p.lesson_id
                WHERE l.course_id = c.id AND p.advisor_id = $1) AS completed,
              EXISTS (SELECT 1 FROM learning.course_completions cc WHERE cc.course_id = c.id AND cc.advisor_id = $1) AS passed
         FROM learning.courses c WHERE c.published ORDER BY c.is_essentials DESC, c.title`,
      [advisorId],
    );
    return rows.map((r) => ({
      slug: r.slug,
      title: r.title,
      summary: r.summary,
      isEssentials: r.is_essentials,
      lessonCount: r.lesson_count,
      lessonsCompleted: r.completed,
      passed: r.passed,
    }));
  }

  async getCourse(slug: string, advisorId: string): Promise<CourseView> {
    const c = await this.course(slug);
    return this.db.transaction('learning', async (tx) => {
      const lessons = await tx.query<{
        id: string;
        position: number;
        title: string;
        est_minutes: number;
        completed: boolean;
      }>(
        `SELECT l.id, l.position, l.title, l.est_minutes,
                EXISTS (SELECT 1 FROM learning.lesson_progress p WHERE p.lesson_id = l.id AND p.advisor_id = $2) AS completed
           FROM learning.lessons l WHERE l.course_id = $1 ORDER BY l.position`,
        [c.id, advisorId],
      );
      const [q] = (await tx.query<{
        n: number;
        today: number;
        best: number | null;
        passed: boolean;
      }>(
        `SELECT (SELECT count(*)::int FROM learning.quiz_questions WHERE course_id = $1) AS n,
                (SELECT count(*)::int FROM learning.quiz_attempts WHERE course_id = $1 AND advisor_id = $2
                   AND submitted_at > now() - interval '24 hours') AS today,
                (SELECT max(score_pct) FROM learning.quiz_attempts WHERE course_id = $1 AND advisor_id = $2) AS best,
                EXISTS (SELECT 1 FROM learning.course_completions WHERE course_id = $1 AND advisor_id = $2) AS passed`,
        [c.id, advisorId],
      )) as [{ n: number; today: number; best: number | null; passed: boolean }];
      const completed = lessons.filter((l) => l.completed).length;
      return {
        slug: c.slug,
        title: c.title,
        summary: c.summary,
        isEssentials: c.is_essentials,
        passMarkPct: c.pass_mark_pct,
        lessonCount: lessons.length,
        lessonsCompleted: completed,
        passed: q.passed,
        lessons: lessons.map((l) => ({
          id: l.id,
          position: l.position,
          title: l.title,
          estMinutes: l.est_minutes,
          completed: l.completed,
        })),
        quiz: {
          questionCount: q.n,
          unlocked: completed === lessons.length,
          attemptsToday: q.today,
          attemptsLeftToday: Math.max(0, MAX_ATTEMPTS_PER_DAY - q.today),
          bestScorePct: q.best,
        },
      };
    });
  }

  async getLesson(slug: string, position: number) {
    const c = await this.course(slug);
    const [l] = await this.db.read<{
      id: string;
      position: number;
      title: string;
      body_md: string;
      est_minutes: number;
    }>(
      'learning',
      'SELECT id, position, title, body_md, est_minutes FROM learning.lessons WHERE course_id = $1 AND position = $2',
      [c.id, position],
    );
    if (!l) throw problem(HttpStatus.NOT_FOUND, 'not-found', 'Lesson not found');
    const [{ total }] = (await this.db.read<{ total: number }>(
      'learning',
      'SELECT count(*)::int AS total FROM learning.lessons WHERE course_id = $1',
      [c.id],
    )) as [{ total: number }];
    return {
      id: l.id,
      position: l.position,
      title: l.title,
      bodyMarkdown: l.body_md,
      estMinutes: l.est_minutes,
      lessonCount: total,
    };
  }

  async completeLesson(slug: string, position: number, advisorId: string): Promise<void> {
    const lesson = await this.getLesson(slug, position);
    await this.db.transaction('learning', (tx) =>
      tx.query(
        'INSERT INTO learning.lesson_progress (advisor_id, lesson_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [advisorId, lesson.id],
      ),
    );
  }

  /** Questions without answers. Available once every lesson is complete. */
  async getQuiz(slug: string, advisorId: string) {
    const view = await this.getCourse(slug, advisorId);
    if (!view.quiz.unlocked)
      throw problem(HttpStatus.CONFLICT, 'lessons-incomplete', 'Finish every lesson first');
    const c = await this.course(slug);
    const qs = await this.db.read<{
      id: string;
      prompt: string;
      options: Array<{ id: string; text: string }>;
    }>(
      'learning',
      'SELECT id, prompt, options FROM learning.quiz_questions WHERE course_id = $1 ORDER BY position',
      [c.id],
    );
    return {
      passMarkPct: c.pass_mark_pct,
      attemptsLeftToday: view.quiz.attemptsLeftToday,
      questions: qs,
    };
  }

  async submitQuiz(
    slug: string,
    advisor: AdvisorSummary,
    answers: Record<string, string>,
  ): Promise<QuizResult> {
    const c = await this.course(slug);
    const view = await this.getCourse(slug, advisor.id);
    if (!view.quiz.unlocked)
      throw problem(HttpStatus.CONFLICT, 'lessons-incomplete', 'Finish every lesson first');
    if (view.quiz.attemptsLeftToday === 0) {
      throw problem(
        HttpStatus.TOO_MANY_REQUESTS,
        'attempts-exhausted',
        'No attempts left today',
        'Review the lessons and try again tomorrow.',
      );
    }
    return this.db.transaction('learning', async (tx) => {
      const questions = await tx.query<QuizQuestion>(
        'SELECT id, correct_option AS "correctOption", explanation FROM learning.quiz_questions WHERE course_id = $1 ORDER BY position',
        [c.id],
      );
      const score = scoreQuiz(questions, answers, c.pass_mark_pct);
      const attemptId = newId();
      await tx.query(
        `INSERT INTO learning.quiz_attempts (id, advisor_id, course_id, answers, score_pct, passed) VALUES ($1, $2, $3, $4, $5, $6)`,
        [attemptId, advisor.id, c.id, JSON.stringify(answers), score.scorePct, score.passed],
      );
      let firstPass = false;
      if (score.passed) {
        const inserted = await tx.query(
          `INSERT INTO learning.course_completions (advisor_id, course_id, attempt_id) VALUES ($1, $2, $3)
           ON CONFLICT DO NOTHING RETURNING course_id`,
          [advisor.id, c.id, attemptId],
        );
        firstPass = inserted.length === 1;
      }
      if (firstPass) {
        await tx.publish({
          type: 'CoursePassed',
          version: 1,
          payload: {
            courseId: c.id,
            courseSlug: c.slug,
            advisorId: advisor.id,
            userId: advisor.userId,
            scorePct: score.scorePct,
          },
        });
        await this.audit.record({
          actorType: 'user',
          action: 'learning.course_passed',
          entityType: 'advisor',
          entityId: advisor.id,
          module: 'learning',
          metadata: { course: c.slug, scorePct: score.scorePct },
        });
        // FR-LRN-02: Essentials gates booking. Same transaction: the completion and the unlock commit together.
        if (c.is_essentials) await this.identity.recordEssentialsPassed(advisor.id);
      }
      const canBook =
        c.is_essentials && score.passed
          ? (await this.identity.getAdvisor(advisor.id))?.status === 'active'
          : false;
      return {
        scorePct: score.scorePct,
        passed: score.passed,
        passMarkPct: c.pass_mark_pct,
        incorrect: score.incorrect,
        review: score.passed
          ? questions.map((q) => ({
              questionId: q.id,
              correctOption: q.correctOption,
              explanation: q.explanation,
            }))
          : null,
        bookingUnlocked: canBook,
      };
    });
  }
}
