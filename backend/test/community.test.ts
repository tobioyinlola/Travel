import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from './app-harness.js';

describe('community forum (FR-CMT-01)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startApp();
  });
  beforeEach(() => t.reset());
  afterAll(() => t.close());

  it('lets members post topics and replies, newest activity first', async () => {
    const a = await t.onboardAdvisor('ada@example.com');
    const b = await t.onboardAdvisor('bo@example.com');
    const cats = (await a.agent.get('/v1/community/categories').expect(200)).body;
    expect(cats.map((c: { slug: string }) => c.slug)).toContain('destinations');

    const t1 = (
      await a.agent
        .post('/v1/community/topics')
        .send({
          category: 'destinations',
          title: 'Best boutique hotels in Lisbon',
          body: 'Looking for small hotels in Alfama with a view.',
        })
        .expect(201)
    ).body;
    const t2 = (
      await b.agent
        .post('/v1/community/topics')
        .send({
          category: 'general',
          title: 'Hello from Lagos',
          body: 'New advisor here, focusing on family trips.',
        })
        .expect(201)
    ).body;
    await b.agent
      .post(`/v1/community/topics/${t1.id}/replies`)
      .send({ body: 'Try the Memmo Alfama, the terrace is lovely.' })
      .expect(201);

    const list = (await a.agent.get('/v1/community/topics').expect(200)).body;
    expect(list.items.map((x: { id: string }) => x.id)).toEqual([t1.id, t2.id]);
    const topic = (await a.agent.get(`/v1/community/topics/${t1.id}`).expect(200)).body;
    expect(topic.opening).toMatchObject({ authorName: 'Ada', mine: true });
    expect(topic.replies).toEqual([
      expect.objectContaining({
        body: 'Try the Memmo Alfama, the terrace is lovely.',
        mine: false,
      }),
    ]);
  });

  it('searches topics and replies', async () => {
    const a = await t.onboardAdvisor('ada@example.com');
    const t1 = (
      await a.agent
        .post('/v1/community/topics')
        .send({
          category: 'destinations',
          title: 'Safari lodges',
          body: 'Which lodges in the Serengeti take families?',
        })
        .expect(201)
    ).body;
    const t2 = (
      await a.agent
        .post('/v1/community/topics')
        .send({
          category: 'general',
          title: 'Marketing ideas',
          body: 'How do you find your first clients?',
        })
        .expect(201)
    ).body;
    await a.agent
      .post(`/v1/community/topics/${t2.id}/replies`)
      .send({ body: 'I posted about my Serengeti trip on Instagram.' })
      .expect(201);

    const hits = (await a.agent.get('/v1/community/topics').query({ q: 'serengeti' }).expect(200))
      .body;
    expect(hits.items.map((x: { id: string }) => x.id).sort()).toEqual([t1.id, t2.id].sort());
    const one = (
      await a.agent.get('/v1/community/topics').query({ q: 'families lodges' }).expect(200)
    ).body;
    expect(one.items.map((x: { id: string }) => x.id)).toEqual([t1.id]);
  });

  it('hides content after 3 reports; a moderator can dismiss and restore it', async () => {
    const author = await t.onboardAdvisor('spam@example.com');
    const topic = (
      await author.agent
        .post('/v1/community/topics')
        .send({
          category: 'general',
          title: 'Cheap watches',
          body: 'Buy cheap watches at example.com',
        })
        .expect(201)
    ).body;
    await author.agent
      .post('/v1/community/reports')
      .send({ targetType: 'topic', targetId: topic.id, reason: 'spam' })
      .expect(400);

    const reporters = [];
    for (const n of ['r1', 'r2', 'r3']) reporters.push(await t.onboardAdvisor(`${n}@example.com`));
    let last;
    for (const r of reporters) {
      last = (
        await r.agent
          .post('/v1/community/reports')
          .send({ targetType: 'topic', targetId: topic.id, reason: 'spam' })
          .expect(202)
      ).body;
    }
    expect(last).toEqual({ hidden: true });
    await reporters[0]!.agent.get(`/v1/community/topics/${topic.id}`).expect(404);

    const mod = await t.admin1();
    const queue = (await mod.get('/v1/community/moderation/reports').expect(200)).body;
    expect(queue).toEqual([
      expect.objectContaining({ targetId: topic.id, reports: 3, hidden: true }),
    ]);
    await reporters[0]!.agent.get('/v1/community/moderation/reports').expect(403);

    await mod
      .post(`/v1/community/moderation/topic/${topic.id}`)
      .send({ action: 'dismiss' })
      .expect(204);
    await mod
      .post(`/v1/community/moderation/topic/${topic.id}`)
      .send({ action: 'unhide' })
      .expect(204);
    expect((await mod.get('/v1/community/moderation/reports').expect(200)).body).toEqual([]);
    await reporters[0]!.agent.get(`/v1/community/topics/${topic.id}`).expect(200);
  });

  it('locks topics against replies and only lets authors edit their own posts', async () => {
    const a = await t.onboardAdvisor('ada@example.com');
    const b = await t.onboardAdvisor('bo@example.com');
    const topic = (
      await a.agent
        .post('/v1/community/topics')
        .send({ category: 'general', title: 'Lock me please', body: 'Original text' })
        .expect(201)
    ).body;
    await b.agent
      .patch(`/v1/community/topics/${topic.id}`)
      .send({ body: 'Vandalised' })
      .expect(404);
    await a.agent
      .patch(`/v1/community/topics/${topic.id}`)
      .send({ body: 'Edited text' })
      .expect(204);
    const mod = await t.admin1();
    await mod
      .post(`/v1/community/moderation/topic/${topic.id}`)
      .send({ action: 'lock' })
      .expect(204);
    const res = await b.agent
      .post(`/v1/community/topics/${topic.id}/replies`)
      .send({ body: 'Too late' })
      .expect(409);
    expect(res.body.type).toMatch(/topic-locked/);
    const view = (await a.agent.get(`/v1/community/topics/${topic.id}`).expect(200)).body;
    expect(view).toMatchObject({ locked: true, opening: { body: 'Edited text' } });
    expect(view.opening.editedAt).not.toBeNull();
  });

  it('is for members only: applicants are refused', async () => {
    const applicant = await t.signUpAdvisor('new@example.com');
    await applicant.agent.get('/v1/community/topics').expect(403);
  });
});
