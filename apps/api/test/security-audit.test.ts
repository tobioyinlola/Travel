import type { OpenAPIObject } from '@nestjs/swagger';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';
import { buildOpenApi } from '../src/http-app.js';
import { startApp, type TestApp } from './app-harness.js';

type Op = { method: 'get' | 'post' | 'put' | 'patch' | 'delete'; path: string; url: string };
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;

/**
 * The complete list of routes that work without signing in. Adding a route here is a security decision: review it.
 * Everything else must answer 401 to an anonymous caller.
 */
const PUBLIC_ROUTES = [
  'GET /v1/health',
  // Sign-up and sign-in
  'POST /v1/auth/register',
  'POST /v1/auth/verify',
  'POST /v1/auth/login',
  'POST /v1/auth/verify/resend',
  'POST /v1/auth/password-reset/request',
  'POST /v1/auth/password-reset/confirm',
  'POST /v1/auth/logout',
  // Public price list
  'GET /v1/membership/plans',
  // Traveler link pages: the secret token is the credential
  'GET /v1/proposal-links/{token}',
  'POST /v1/proposal-links/{token}/decision',
  'GET /v1/checkout/{token}',
  'GET /v1/proposal-links/{token}/messages',
  'POST /v1/proposal-links/{token}/messages',
  'POST /v1/checkout/{token}/confirm',
  // Development stand-ins for provider pages (the app refuses to start in production with them)
  'POST /v1/dev/fake-kyc/{reference}/{outcome}',
  'POST /v1/dev/fake-signature/{envelopeRef}/{outcome}',
  'POST /v1/dev/fake-payments/{clientToken}/pay',
  'POST /v1/dev/fake-payments/{clientToken}/dispute',
].sort();

/** Reachable with a password-only session so that MFA can be set up or completed. */
const MFA_EXEMPT = [
  'GET /v1/auth/me',
  'POST /v1/auth/mfa/enroll',
  'POST /v1/auth/mfa/enroll/confirm',
  'POST /v1/auth/mfa/challenge',
].sort();

const STAFF_ONLY = [
  '/v1/admin',
  '/v1/finance',
  '/v1/support',
  '/v1/reports/platform',
  '/v1/reports/finance',
  '/v1/ai/admin',
];
const ADVISOR_ONLY = [
  '/v1/trips',
  '/v1/clients',
  '/v1/bookings',
  '/v1/commissions',
  '/v1/payouts',
  '/v1/ai/ask',
  '/v1/ai/drafts',
  '/v1/reports/advisor',
];

describe('security audit: every route, authentication, MFA and roles (FR-AUTH-02, FR-AUTH-09, NFR security)', () => {
  let t: TestApp;
  let ops: Op[];
  const fill = (p: string) =>
    p.replace(/\{[^}]+\}/g, (m) =>
      m.includes('token') ? 'x'.repeat(43) : '00000000-0000-7000-8000-000000000000',
    );
  const key = (o: Op) => `${o.method.toUpperCase()} ${o.path}`;
  const call = (agent: request.Agent | ReturnType<typeof request>, o: Op) =>
    agent[o.method](o.url).set('Idempotency-Key', crypto.randomUUID()).send({}).timeout(5000);

  beforeAll(async () => {
    t = await startApp();
    const doc = buildOpenApi(t.app) as OpenAPIObject;
    ops = Object.entries(doc.paths).flatMap(([path, item]) =>
      METHODS.filter((m) => (item as Record<string, unknown>)[m]).map((method) => ({
        method,
        path,
        url: fill(path),
      })),
    );
  });
  afterAll(() => t.close());

  it('has a sensible number of routes to audit', () => {
    expect(ops.length).toBeGreaterThan(100);
  });

  it('only the listed routes are reachable without signing in; everything else answers 401', async () => {
    const open: string[] = [];
    for (const o of ops) {
      const res = await call(request(t.app.getHttpServer()), o);
      if (res.status !== 401) open.push(key(o));
    }
    expect(open.sort()).toEqual(PUBLIC_ROUTES);
  });

  it('a password-only session (no MFA yet) can reach nothing but the MFA routes, for every role that requires it', async () => {
    await t.reset();
    const adm = await t.admin1(); // creates the admin and enrols MFA once
    void adm;
    for (const [email, role] of [
      ['ada@example.com', 'advisor'],
      ['admin@atp.test', 'admin'],
    ] as const) {
      if (role === 'advisor') await t.signUpAdvisor(email);
      const agent = request.agent(t.app.getHttpServer());
      await agent
        .post('/v1/auth/login')
        .send({
          identifier: email,
          password:
            role === 'advisor' ? 'correct horse battery staple' : 'admin password long enough',
        })
        .expect(200);
      const leaked: string[] = [];
      for (const o of ops) {
        const k = key(o);
        if (PUBLIC_ROUTES.includes(k) || MFA_EXEMPT.includes(k)) continue;
        const res = await call(agent, o);
        if (res.status !== 403 || !/mfa-required$/.test(res.body?.type ?? ''))
          leaked.push(`${role}: ${k} -> ${res.status}`);
      }
      expect(leaked).toEqual([]);
    }
  });

  it('an advisor with MFA cannot use any staff route; staff cannot use advisor routes', async () => {
    await t.reset();
    const ada = await t.signUpAdvisor('ada@example.com');
    const adm = await t.admin1();
    const wrongForAdvisor: string[] = [];
    for (const o of ops.filter((x) => STAFF_ONLY.some((p) => x.path.startsWith(p)))) {
      const res = await call(ada.agent, o);
      if (res.status !== 403) wrongForAdvisor.push(`${key(o)} -> ${res.status}`);
    }
    expect(wrongForAdvisor).toEqual([]);
    const wrongForAdmin: string[] = [];
    for (const o of ops.filter(
      (x) =>
        ADVISOR_ONLY.some((p) => x.path.startsWith(p)) &&
        !STAFF_ONLY.some((p) => x.path.startsWith(p)),
    )) {
      const res = await call(adm, o);
      if (res.status !== 403) wrongForAdmin.push(`${key(o)} -> ${res.status}`);
    }
    expect(wrongForAdmin).toEqual([]);
  });

  it('every response carries the security headers, and nothing is cacheable', async () => {
    const res = await request(t.app.getHttpServer()).get('/v1/health');
    expect(res.headers).toMatchObject({
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
      'referrer-policy': 'no-referrer',
      'cache-control': 'no-store',
    });
    expect(res.headers['content-security-policy']).toContain("default-src 'none'");
    expect(res.headers['x-powered-by']).toBeUndefined();
    const err = await request(t.app.getHttpServer()).get('/v1/nope');
    expect(err.headers['x-content-type-options']).toBe('nosniff');
  });

  it('refuses oversized bodies and cross-site browser writes', async () => {
    const big = await request(t.app.getHttpServer())
      .post('/v1/auth/login')
      .send({ identifier: 'a', password: 'x'.repeat(1_200_000) });
    expect(big.status).toBe(413);
    const cross = await request(t.app.getHttpServer())
      .post('/v1/auth/login')
      .set('Origin', 'https://evil.example')
      .send({ identifier: 'a', password: 'b' });
    expect(cross.status).toBe(403);
  });
});

describe('production configuration is refused unless it is safe', () => {
  const prod = {
    NODE_ENV: 'production',
    FIELD_ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
    PROVIDERS_MODE: 'live',
    MAIL_TRANSPORT: 'smtp',
    DATABASE_URL: 'postgres://app:S3cure!pw@db.internal:5432/atp',
    WEB_ORIGINS: 'https://app.example.com',
    WEB_BASE_URL: 'https://app.example.com',
    TRUST_PROXY: '2',
    METRICS_TOKEN: 'a-long-metrics-token-1',
  };
  it('accepts a complete production environment', () => {
    expect(() => loadConfig(prod)).not.toThrow();
  });
  it.each([
    [
      'dev encryption key',
      { FIELD_ENCRYPTION_KEY: 'ZGV2LW9ubHkta2V5LWRvLW5vdC11c2UtaW4tcHJvZCE=' },
    ],
    ['fake providers', { PROVIDERS_MODE: 'fake' }],
    ['non-smtp mail', { MAIL_TRANSPORT: 'log' }],
    ['development database password', { DATABASE_URL: 'postgres://atp_app:atp_app@db:5432/atp' }],
    ['plain-http origins', { WEB_ORIGINS: 'http://app.example.com' }],
    ['plain-http links', { WEB_BASE_URL: 'http://app.example.com' }],
    ['default proxy trust', { TRUST_PROXY: 'loopback' }],
    ['no metrics token', { METRICS_TOKEN: undefined }],
  ])('rejects %s', (_name, override) => {
    expect(() => loadConfig({ ...prod, ...override })).toThrow();
  });
});
