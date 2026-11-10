import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startApp, type TestApp } from './app-harness.js';

type Agent = ReturnType<typeof request.agent>;
const OLD = 'correct horse battery staple';
const NEW = 'a brand new passphrase 2026';

describe('password reset and ending sessions (FR-AUTH-01 recovery, FR-ADM-02)', () => {
  let t: TestApp;
  let ada: { agent: Agent; advisorId: string; userId: string; secret: string };

  beforeAll(async () => {
    t = await startApp();
  });
  beforeEach(async () => {
    await t.reset();
    ada = {
      ...(await t.onboardAdvisor('ada@example.com', { essentials: true })),
      ...(await userOf()),
    } as typeof ada;
  });
  afterAll(() => t.close());

  async function userOf() {
    const u = (await t.admin.query(`SELECT user_id FROM identity.advisors LIMIT 1`)).rows[0];
    return { userId: u.user_id as string, secret: '' };
  }
  const ask = (identifier: string) =>
    t.http().post('/v1/auth/password-reset/request').send({ identifier });
  const tokenFromMail = (to = 'ada@example.com') => {
    const m = [...t.mail.sent]
      .reverse()
      .find((x) => x.to === to && /reset-password\?token=/.test(x.text));
    return m?.text.match(/token=([A-Za-z0-9_-]+)/)?.[1];
  };
  const confirm = (token: string | undefined, password = NEW) =>
    t.http().post('/v1/auth/password-reset/confirm').send({ token, password });

  it('emails a single-use link, and answers the same for an unknown address', async () => {
    const known = await ask('ada@example.com').expect(202);
    const unknown = await ask('nobody@example.com').expect(202);
    expect(unknown.body).toEqual(known.body);
    await t.settle();
    expect(tokenFromMail()).toBeTruthy();
    expect(t.mail.sent.filter((m) => m.to === 'nobody@example.com')).toHaveLength(0);
    // Only a hash is stored: the token is not in the database.
    const stored = (await t.admin.query(`SELECT token_hash FROM identity.password_resets`)).rows;
    expect(stored).toHaveLength(1);
    expect(stored[0].token_hash).not.toContain(tokenFromMail()!);
    const outbox = await t.admin.query(
      `SELECT body_text FROM notifications.messages WHERE template = 'password_reset'`,
    );
    expect(outbox.rows[0].body_text).toBe('[redacted]');
  });

  it('sets the new password, signs the account out everywhere and tells the owner', async () => {
    await ada.agent.get('/v1/auth/me').expect(200);
    await ask('ada@example.com').expect(202);
    await t.settle();
    const token = tokenFromMail();
    await confirm(token).expect(204);
    await t.settle();

    await ada.agent.get('/v1/auth/me').expect(401); // the old session is gone
    const fresh = request.agent(t.app.getHttpServer());
    await fresh
      .post('/v1/auth/login')
      .send({ identifier: 'ada@example.com', password: OLD })
      .expect(401);
    await fresh
      .post('/v1/auth/login')
      .send({ identifier: 'ada@example.com', password: NEW })
      .expect(200);
    expect(
      t.mail.sent.filter(
        (m) => m.to === 'ada@example.com' && /password was changed/i.test(m.subject),
      ),
    ).toHaveLength(1);

    // A reset does not switch MFA off: the new session still has to pass the second factor.
    const me = (await fresh.get('/v1/auth/me').expect(200)).body;
    expect(me.next).toBe('mfa_challenge');
    await fresh.get('/v1/trips').expect(403);
    const used = await confirm(token, 'yet another passphrase 99').expect(400); // single use
    expect(used.body.type).toMatch(/reset-invalid$/);
  });

  it('refuses expired, unknown and weak resets, and a newer link retires the older one', async () => {
    await confirm('x'.repeat(43)).expect(400);
    await ask('ada@example.com').expect(202);
    await t.settle();
    const first = tokenFromMail()!;
    await confirm(first, 'short').expect(400); // weak password: token not burned
    await t.admin.query(
      `UPDATE identity.password_resets SET expires_at = now() - interval '1 minute'`,
    );
    await confirm(first).expect(400); // expired

    await ask('ada@example.com').expect(202);
    await t.settle();
    const second = tokenFromMail()!;
    expect(second).not.toBe(first);
    await ask('ada@example.com').expect(202);
    await t.settle();
    await confirm(second).expect(400); // replaced by the third request
    await confirm(tokenFromMail()!).expect(204);
  });

  it('limits how many links one address can get in an hour, silently', async () => {
    for (let i = 0; i < 5; i++) await ask('ada@example.com').expect(202);
    await t.settle();
    expect(
      t.mail.sent.filter((m) => m.to === 'ada@example.com' && /reset-password/.test(m.text)),
    ).toHaveLength(3);
  });

  it('suspending or offboarding an advisor ends their sessions at once (FR-ADM-02)', async () => {
    const adm = await t.admin1();
    await ada.agent.get('/v1/bookings').expect(200);
    await adm
      .post(`/v1/admin/advisors/${ada.advisorId}/suspend`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ reason: 'Under review' })
      .expect(200);
    await ada.agent.get('/v1/bookings').expect(401);

    // Reinstating does not bring the old session back: they sign in again.
    await adm
      .post(`/v1/admin/advisors/${ada.advisorId}/reinstate`)
      .set('Idempotency-Key', crypto.randomUUID())
      .send({ reason: 'Cleared' })
      .expect(200);
    await ada.agent.get('/v1/bookings').expect(401);
  });
});
