import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { totp } from '../src/modules/identity/domain/totp.js';
import { startApp, type TestApp } from './app-harness.js';

const PASSWORD = 'correct horse battery staple';

describe('identity: registration, sessions and MFA (FR-AUTH-01, 02, 09)', () => {
  let t: TestApp;

  beforeAll(async () => {
    t = await startApp();
  });
  beforeEach(() => t.reset());
  afterAll(() => t.close());

  it('keeps health and webhooks reachable without a session, and protects everything else', async () => {
    await t.http().get('/v1/health').expect(200);
    await t.http().post('/webhooks/unknown').send({}).expect(404);
    await t.http().get('/v1/membership').expect(401);
    await t.http().get('/v1/membership/plans').expect(200);
  });

  it('registers with email, sends a code, verifies, then requires MFA enrolment', async () => {
    const agent = request.agent(t.app.getHttpServer());
    const reg = await agent
      .post('/v1/auth/register')
      .send({ email: 'Ada@Example.com', password: PASSWORD })
      .expect(201);
    expect(reg.body.channel).toBe('email');
    await t.settle();
    const code = t.mail.lastCodeFor('ada@example.com');
    expect(code).toMatch(/^\d{6}$/);

    const verified = await agent
      .post('/v1/auth/verify')
      .send({ userId: reg.body.userId, code })
      .expect(200);
    expect(verified.body).toMatchObject({
      role: 'advisor',
      next: 'mfa_enroll',
      mfaVerified: false,
    });
    const cookie = String(verified.headers['set-cookie']);
    expect(cookie).toMatch(/atp_session=/);
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);

    // Password-only session: MFA-protected routes are refused, enrolment is allowed.
    const blocked = await agent.get('/v1/advisor-application').expect(403);
    expect(blocked.body.type).toMatch(/mfa-required/);
    await agent.get('/v1/auth/me').expect(200);
  });

  it('never stores the one-time code in the message log', async () => {
    await t
      .http()
      .post('/v1/auth/register')
      .send({ email: 'b@example.com', password: PASSWORD })
      .expect(201);
    await t.settle();
    const { rows } = await t.admin.query(
      `SELECT body_text, status FROM notifications.messages WHERE template = 'verification_code'`,
    );
    expect(rows).toEqual([{ body_text: '[redacted]', status: 'sent' }]);
  });

  it('registers with a phone number and sends the code by SMS', async () => {
    const reg = await t
      .http()
      .post('/v1/auth/register')
      .send({ phone: '+2348012345678', password: PASSWORD })
      .expect(201);
    expect(reg.body.channel).toBe('sms');
    await t.settle();
    expect(t.mail.sent.at(-1)).toMatchObject({ channel: 'sms', to: '+2348012345678' });
  });

  it('rejects wrong codes, then locks the code after 5 attempts', async () => {
    const reg = await t
      .http()
      .post('/v1/auth/register')
      .send({ email: 'c@example.com', password: PASSWORD })
      .expect(201);
    await t.settle();
    const good = t.mail.lastCodeFor('c@example.com')!;
    const bad = good === '000000' ? '111111' : '000000';
    for (let i = 0; i < 5; i++)
      await t
        .http()
        .post('/v1/auth/verify')
        .send({ userId: reg.body.userId, code: bad })
        .expect(400);
    await t
      .http()
      .post('/v1/auth/verify')
      .send({ userId: reg.body.userId, code: good })
      .expect(400);
  });

  it('refuses a duplicate email and weak passwords', async () => {
    await t
      .http()
      .post('/v1/auth/register')
      .send({ email: 'd@example.com', password: PASSWORD })
      .expect(201);
    const dup = await t
      .http()
      .post('/v1/auth/register')
      .send({ email: 'D@example.com', password: PASSWORD })
      .expect(409);
    expect(dup.body.type).toMatch(/account-exists/);
    await t
      .http()
      .post('/v1/auth/register')
      .send({ email: 'e@example.com', password: 'short' })
      .expect(400);
    await t.http().post('/v1/auth/register').send({ password: PASSWORD }).expect(400);
  });

  it('locks sign-in after 5 failed passwords (brute-force lockout)', async () => {
    await t.signUpAdvisor('f@example.com');
    for (let i = 0; i < 5; i++) {
      await t
        .http()
        .post('/v1/auth/login')
        .send({ identifier: 'f@example.com', password: 'wrong password!!' })
        .expect(401);
    }
    const locked = await t
      .http()
      .post('/v1/auth/login')
      .send({ identifier: 'f@example.com', password: PASSWORD })
      .expect(429);
    expect(locked.body.type).toMatch(/locked-out/);
  });

  it('challenges MFA on sign-in, rejects a replayed code, accepts a recovery code once', async () => {
    const { secret, recoveryCodes } = await t.signUpAdvisor('g@example.com');
    expect(recoveryCodes).toHaveLength(10);
    const login = async () => {
      const agent = request.agent(t.app.getHttpServer());
      const res = await agent
        .post('/v1/auth/login')
        .send({ identifier: 'g@example.com', password: PASSWORD })
        .expect(200);
      expect(res.body.next).toBe('mfa_challenge');
      return agent;
    };

    // The code used at enrolment a moment ago is in the same 30 s step: replay is refused.
    const a1 = await login();
    await a1
      .post('/v1/auth/mfa/challenge')
      .send({ code: totp(secret, new Date()) })
      .expect(400);
    await a1.get('/v1/advisor-application').expect(403);

    const ok = await a1
      .post('/v1/auth/mfa/challenge')
      .send({ recoveryCode: recoveryCodes[0] })
      .expect(200);
    expect(ok.body).toMatchObject({ mfaVerified: true, next: null });
    await a1.get('/v1/advisor-application').expect(404); // past the MFA gate; no application yet

    const a2 = await login();
    await a2.post('/v1/auth/mfa/challenge').send({ recoveryCode: recoveryCodes[0] }).expect(400);
  });

  it('signs out and the session stops working', async () => {
    const { agent } = await t.signUpAdvisor('i@example.com');
    await agent.get('/v1/auth/me').expect(200);
    await agent.post('/v1/auth/logout').expect(204);
    await agent.get('/v1/auth/me').expect(401);
  });

  it('audits logins and failed logins (FR-AUTH-09)', async () => {
    const { userId } = await t.signUpAdvisor('j@example.com');
    await t
      .http()
      .post('/v1/auth/login')
      .send({ identifier: 'j@example.com', password: 'nope nope nope' })
      .expect(401);
    await t
      .http()
      .post('/v1/auth/login')
      .send({ identifier: 'j@example.com', password: PASSWORD })
      .expect(200);
    const { rows } = await t.admin.query(
      `SELECT action FROM audit.log WHERE entity_id = $1 ORDER BY occurred_at`,
      [userId],
    );
    expect(rows.map((r) => r.action)).toEqual(
      expect.arrayContaining([
        'user.registered',
        'user.contact_verified',
        'auth.mfa_enabled',
        'auth.login_failed',
        'auth.login',
      ]),
    );
  });

  it('rejects state-changing requests from an unknown browser origin', async () => {
    await t
      .http()
      .post('/v1/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ identifier: 'x', password: 'y' })
      .expect(403);
  });
});
