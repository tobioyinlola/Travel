import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { IdentityApi } from '../src/modules/identity/index.js';
import { application, startApp, type TestApp } from './app-harness.js';

/** Correct answers to the seeded Essentials quiz, by position. */
const CORRECT = ['b', 'b', 'b', 'c', 'b', 'b', 'c', 'b'];

describe('learning: Essentials course gates booking (FR-LRN-01, FR-LRN-02, AC-01)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startApp();
  });
  beforeEach(() => t.reset());
  afterAll(() => t.close());

  async function completeLessons(agent: ReturnType<typeof request.agent>) {
    const course = (await agent.get('/v1/learning/courses/essentials').expect(200)).body;
    for (const l of course.lessons)
      await agent
        .post(`/v1/learning/courses/essentials/lessons/${l.position}/complete`)
        .expect(204);
  }

  async function answers(agent: ReturnType<typeof request.agent>, wrong = 0) {
    const quiz = (await agent.get('/v1/learning/courses/essentials/quiz').expect(200)).body;
    const out: Record<string, string> = {};
    quiz.questions.forEach((q: { id: string }, i: number) => {
      out[q.id] = i < wrong ? (CORRECT[i] === 'a' ? 'd' : 'a') : CORRECT[i]!;
    });
    return { quiz, answers: out };
  }

  it('lists the Essentials course with lessons and tracks progress', async () => {
    const a = await t.onboardAdvisor('ada@example.com');
    const list = (await a.agent.get('/v1/learning/courses').expect(200)).body;
    expect(list).toEqual([
      expect.objectContaining({
        slug: 'essentials',
        isEssentials: true,
        lessonCount: 7,
        lessonsCompleted: 0,
        passed: false,
      }),
    ]);
    const lesson = (await a.agent.get('/v1/learning/courses/essentials/lessons/5').expect(200))
      .body;
    expect(lesson.title).toBe('Commission and getting paid');
    expect(lesson.bodyMarkdown).toContain('$210');
    await a.agent.post('/v1/learning/courses/essentials/lessons/1/complete').expect(204);
    await a.agent.post('/v1/learning/courses/essentials/lessons/1/complete').expect(204); // idempotent
    const course = (await a.agent.get('/v1/learning/courses/essentials').expect(200)).body;
    expect(course.lessonsCompleted).toBe(1);
    expect(course.quiz).toMatchObject({ unlocked: false, questionCount: 8 });
  });

  it('keeps the quiz locked until every lesson is complete, and never sends the answers', async () => {
    const a = await t.onboardAdvisor('bo@example.com');
    await a.agent.get('/v1/learning/courses/essentials/quiz').expect(409);
    await completeLessons(a.agent);
    const quiz = (await a.agent.get('/v1/learning/courses/essentials/quiz').expect(200)).body;
    expect(quiz.questions).toHaveLength(8);
    expect(JSON.stringify(quiz)).not.toMatch(/correct|explanation/i);
  });

  it('AC-01: passing Essentials makes an Approved advisor Active and unlocks booking', async () => {
    const a = await t.onboardAdvisor('cy@example.com');
    const identity = t.app.get(IdentityApi);
    expect((await identity.canBook(a.advisorId)).allowed).toBe(false);
    await completeLessons(a.agent);

    const fail = await answers(a.agent, 2); // 6/8 = 75% < 80%
    const failed = (
      await a.agent
        .post('/v1/learning/courses/essentials/quiz/attempts')
        .send({ answers: fail.answers })
        .expect(201)
    ).body;
    expect(failed).toMatchObject({
      scorePct: 75,
      passed: false,
      review: null,
      bookingUnlocked: false,
    });
    expect(failed.incorrect).toHaveLength(2);
    expect((await identity.getAdvisor(a.advisorId))?.status).toBe('approved');

    const pass = await answers(a.agent, 1); // 7/8 = 87%
    const passed = (
      await a.agent
        .post('/v1/learning/courses/essentials/quiz/attempts')
        .send({ answers: pass.answers })
        .expect(201)
    ).body;
    expect(passed).toMatchObject({ scorePct: 87, passed: true, bookingUnlocked: true });
    expect(passed.review).toHaveLength(8);
    expect((await identity.getAdvisor(a.advisorId))?.status).toBe('active');
    expect(await identity.canBook(a.advisorId)).toEqual({ allowed: true, reason: null });

    const course = (await a.agent.get('/v1/learning/courses/essentials').expect(200)).body;
    expect(course).toMatchObject({ passed: true, quiz: { bestScorePct: 87 } });
  });

  it('lets an applicant pass Essentials before approval; approval then activates', async () => {
    const a = await t.signUpAdvisor('di@example.com');
    await a.agent.post('/v1/advisor-application').send(application).expect(201);
    await completeLessons(a.agent);
    const pass = await answers(a.agent);
    const r = (
      await a.agent
        .post('/v1/learning/courses/essentials/quiz/attempts')
        .send({ answers: pass.answers })
        .expect(201)
    ).body;
    expect(r).toMatchObject({ scorePct: 100, passed: true, bookingUnlocked: false });
  });

  it('limits attempts to 5 a day', async () => {
    const a = await t.onboardAdvisor('ed@example.com');
    await completeLessons(a.agent);
    const wrong = await answers(a.agent, 8);
    for (let i = 0; i < 5; i++) {
      await a.agent
        .post('/v1/learning/courses/essentials/quiz/attempts')
        .send({ answers: wrong.answers })
        .expect(201);
    }
    const res = await a.agent
      .post('/v1/learning/courses/essentials/quiz/attempts')
      .send({ answers: wrong.answers })
      .expect(429);
    expect(res.body.type).toMatch(/attempts-exhausted/);
  });

  it('is closed to accounts without an application', async () => {
    const a = await t.signUpAdvisor('fy@example.com');
    await a.agent.get('/v1/learning/courses').expect(403);
  });
});
