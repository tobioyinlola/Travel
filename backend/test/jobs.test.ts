import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { DeadLetterService } from '../src/platform/jobs/dead-letters.js';
import { makePlatform, type TestPlatform } from './helpers.js';

describe('background jobs', () => {
  let p: TestPlatform;
  let deadLetters: DeadLetterService;
  const seen: unknown[] = [];
  let failNext = true;

  beforeAll(() => {
    p = makePlatform();
    deadLetters = new DeadLetterService(p.db);
    p.jobs.register<{ n: number }>({
      name: 'booking.test-reserve',
      module: 'booking',
      queue: 'critical',
      handle: async (payload, ctx) => {
        seen.push({ payload, correlationId: ctx.correlationId });
      },
    });
    p.jobs.register({
      name: 'booking.test-flaky',
      module: 'booking',
      queue: 'critical',
      maxAttempts: 1,
      handle: async () => {
        if (failNext) throw new Error('supplier timeout');
        seen.push('flaky-ok');
      },
    });
  });

  beforeEach(async () => {
    seen.length = 0;
    await p.reset();
  });

  afterAll(async () => {
    await deadLetters.release();
    await p.close();
  });

  it('enqueues in the same transaction as the business write', async () => {
    await expect(
      p.db.transaction('booking', async (tx) => {
        await tx.enqueue('booking.test-reserve', { n: 1 });
        throw new Error('rollback');
      }),
    ).rejects.toThrow();
    await p.runJobs();
    expect(seen).toEqual([]);

    await p.db.transaction('booking', (tx) => tx.enqueue('booking.test-reserve', { n: 2 }));
    await p.runJobs();
    expect(seen).toEqual([{ payload: { n: 2 }, correlationId: expect.any(String) }]);
  });

  it('de-duplicates by job key', async () => {
    await p.db.transaction('booking', async (tx) => {
      await tx.enqueue('booking.test-reserve', { n: 1 }, { jobKey: 'booking-42' });
      await tx.enqueue('booking.test-reserve', { n: 1 }, { jobKey: 'booking-42' });
    });
    await p.runJobs();
    expect(seen).toHaveLength(1);
  });

  it('refuses to enqueue an unregistered job', async () => {
    await expect(
      p.db.transaction('booking', (tx) => tx.enqueue('booking.nope', {})),
    ).rejects.toThrow(/Unknown job/);
  });

  it('dead-letters a job that exhausts its attempts and replays it on request', async () => {
    failNext = true;
    await p.db.transaction('booking', (tx) => tx.enqueue('booking.test-flaky', {}));
    await p.runJobs();
    const dead = await deadLetters.list();
    expect(dead).toHaveLength(1);
    expect(dead[0]).toMatchObject({ task: 'booking.test-flaky', attempts: 1, maxAttempts: 1 });
    expect(dead[0]?.lastError).toMatch(/supplier timeout/);

    failNext = false;
    expect(await deadLetters.replay([dead[0]!.id])).toBe(1);
    // The replayed job is due "now"; give the runner a few passes rather than assuming the first sees it.
    for (let i = 0; i < 5 && !seen.includes('flaky-ok'); i++) {
      await p.runJobs();
      if (!seen.includes('flaky-ok')) await new Promise((r) => setTimeout(r, 100));
    }
    expect(seen).toContain('flaky-ok');
    expect(await deadLetters.list()).toHaveLength(0);
  });
});
