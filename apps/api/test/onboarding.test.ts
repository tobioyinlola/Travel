import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { IdentityApi } from '../src/modules/identity/index.js';
import { application, startApp, type TestApp } from './app-harness.js';

const key = () => randomUUID();

describe('advisor onboarding (AC-01, FR-AUTH-03..07, FR-MEM-01/02/04/07, FR-ADM-01)', () => {
  let t: TestApp;
  let identity: IdentityApi;

  beforeAll(async () => {
    t = await startApp();
    identity = t.app.get(IdentityApi);
  });
  beforeEach(() => t.reset());
  afterAll(() => t.close());

  /** Applicant who has submitted, verified identity and signed the agreement. */
  async function readyForReview(email: string) {
    const advisor = await t.signUpAdvisor(email);
    const submitted = await advisor.agent
      .post('/v1/advisor-application')
      .send(application)
      .expect(201);
    expect(submitted.body.status).toBe('applied');
    await t.settle();
    const app = (await advisor.agent.get('/v1/advisor-application').expect(200)).body;
    expect(app.kyc.status).toBe('pending');
    expect(app.agreement.status).toBe('sent');
    const kycRef = app.kyc.redirectUrl.match(/fake-kyc\/([^?]+)/)[1];
    const envRef = app.agreement.signingUrl.match(/fake-signature\/(.+)$/)[1];
    await t.http().post(`/v1/dev/fake-kyc/${kycRef}/pass`).expect(202);
    await t.http().post(`/v1/dev/fake-signature/${envRef}/sign`).expect(202);
    await t.settle();
    return { ...advisor, advisorId: app.id as string };
  }

  it('AC-01: verified applicant with signed agreement -> paid membership -> Approved -> Active after Essentials', async () => {
    const admin = await t.signInAdmin();
    const a = await readyForReview('ada@example.com');

    const app = (await a.agent.get('/v1/advisor-application').expect(200)).body;
    expect(app).toMatchObject({
      status: 'under_review',
      kyc: { status: 'passed' },
      agreement: { status: 'signed', version: '2026-11-v1' },
    });
    expect(app.agreement.documentRef).toMatch(/fake-doc/);

    await a.agent
      .post('/v1/membership/checkout')
      .set('Idempotency-Key', key())
      .send({ planCode: 'annual', paymentMethodRef: 'pm_fake_visa' })
      .expect(200);

    const queue = await admin.get('/v1/admin/applications?status=under_review').expect(200);
    expect(queue.body.items.map((i: { id: string }) => i.id)).toEqual([a.advisorId]);

    await admin
      .post(`/v1/admin/applications/${a.advisorId}/decision`)
      .send({ decision: 'accept' })
      .expect(200);
    await t.settle();

    const membership = (await a.agent.get('/v1/membership').expect(200)).body;
    expect(membership.status).toBe('active');
    expect(membership.invoices).toHaveLength(1);
    expect(membership.invoices[0]).toMatchObject({
      status: 'paid',
      total: { amountMinor: '29900', currency: 'USD' },
    });
    expect(membership.invoices[0].number).toMatch(/^MEM-\d{4}-\d{6}$/);

    expect((await identity.getAdvisor(a.advisorId))?.status).toBe('approved');
    expect(await identity.canBook(a.advisorId)).toEqual({
      allowed: false,
      reason: 'status_approved',
    });

    await identity.recordEssentialsPassed(a.advisorId);
    expect((await identity.getAdvisor(a.advisorId))?.status).toBe('active');
    expect(await identity.canBook(a.advisorId)).toEqual({ allowed: true, reason: null });

    const subjects = t.mail.sent.filter((m) => m.to === 'ada@example.com').map((m) => m.subject);
    expect(subjects).toEqual(
      expect.arrayContaining([
        'We received your application',
        'Your application is accepted',
        'Receipt for your membership (299.00 USD)',
        'Welcome aboard',
      ]),
    );

    const detail = (await admin.get(`/v1/admin/applications/${a.advisorId}`).expect(200)).body;
    expect(detail.history.map((h: { action: string }) => h.action)).toEqual(
      expect.arrayContaining([
        'advisor.application_submitted',
        'advisor.kyc_passed',
        'advisor.agreement_signed',
        'advisor.checks_completed',
        'advisor.application_accepted',
        'advisor.membership_paid',
        'advisor.essentials_passed',
      ]),
    );
  });

  it('blocks booking until Active, and Active needs Essentials (FR-AUTH-07)', async () => {
    const a = await readyForReview('bob@example.com');
    await identity.recordEssentialsPassed(a.advisorId); // course passed before approval
    expect((await identity.getAdvisor(a.advisorId))?.status).toBe('under_review');
    expect((await identity.canBook(a.advisorId)).allowed).toBe(false);
    const admin = await t.signInAdmin();
    await a.agent
      .post('/v1/membership/checkout')
      .set('Idempotency-Key', key())
      .send({ planCode: 'quarterly', paymentMethodRef: 'pm_fake_visa' })
      .expect(200);
    await admin
      .post(`/v1/admin/applications/${a.advisorId}/decision`)
      .send({ decision: 'accept' })
      .expect(200);
    await t.settle();
    // Approved and already passed Essentials: goes straight to Active.
    expect((await identity.getAdvisor(a.advisorId))?.status).toBe('active');
  });

  it('cannot accept an application before identity and agreement checks are done', async () => {
    const admin = await t.signInAdmin();
    const a = await t.signUpAdvisor('cy@example.com');
    const app = (await a.agent.post('/v1/advisor-application').send(application).expect(201)).body;
    const res = await admin
      .post(`/v1/admin/applications/${app.id}/decision`)
      .send({ decision: 'accept' })
      .expect(409);
    expect(res.body.type).toMatch(/not-reviewable/);
  });

  it('a declined card keeps the applicant unapproved; a new card retries and approves', async () => {
    const admin = await t.signInAdmin();
    const a = await readyForReview('dee@example.com');
    await a.agent
      .post('/v1/membership/checkout')
      .set('Idempotency-Key', key())
      .send({ planCode: 'annual', paymentMethodRef: 'pm_fake_declined' })
      .expect(200);
    await admin
      .post(`/v1/admin/applications/${a.advisorId}/decision`)
      .send({ decision: 'accept' })
      .expect(200);
    await t.settle();

    let m = (await a.agent.get('/v1/membership').expect(200)).body;
    expect(m.status).toBe('pending');
    expect(m.invoices[0]).toMatchObject({ status: 'open', lastError: 'card_declined' });
    expect((await identity.getAdvisor(a.advisorId))?.status).toBe('under_review');
    expect(
      t.mail.sent.some((x) => x.subject === 'Your membership payment did not go through'),
    ).toBe(true);

    await a.agent
      .put('/v1/membership/payment-method')
      .set('Idempotency-Key', key())
      .send({ paymentMethodRef: 'pm_fake_visa' })
      .expect(200);
    await t.settle();
    m = (await a.agent.get('/v1/membership').expect(200)).body;
    expect(m.status).toBe('active');
    expect(m.invoices).toHaveLength(1);
    expect((await identity.getAdvisor(a.advisorId))?.status).toBe('approved');
  });

  it('a pilot fee waiver approves without charging (FR-MEM-04)', async () => {
    const admin = await t.signInAdmin();
    await admin
      .post('/v1/admin/promo-codes')
      .send({ code: 'PILOT100', kind: 'waiver', maxRedemptions: 100 })
      .expect(201);
    const a = await readyForReview('eve@example.com');
    const quote = await t
      .http()
      .get('/v1/membership/quote?planCode=annual&promoCode=PILOT100')
      .expect(200);
    expect(quote.body.total.amountMinor).toBe('0');
    await a.agent
      .post('/v1/membership/checkout')
      .set('Idempotency-Key', key())
      .send({ planCode: 'annual', promoCode: 'PILOT100', paymentMethodRef: 'pm_fake_declined' })
      .expect(200);
    await admin
      .post(`/v1/admin/applications/${a.advisorId}/decision`)
      .send({ decision: 'accept' })
      .expect(200);
    await t.settle();
    const m = (await a.agent.get('/v1/membership').expect(200)).body;
    expect(m.invoices[0]).toMatchObject({
      status: 'paid',
      total: { amountMinor: '0' },
      discount: { amountMinor: '29900' },
    });
    expect((await identity.getAdvisor(a.advisorId))?.status).toBe('approved');
    const { rows } = await t.admin.query(
      `SELECT redemptions FROM membership.promo_codes WHERE code = 'PILOT100'`,
    );
    expect(rows[0].redemptions).toBe(1);
  });

  it('rejects an expired promo code', async () => {
    const admin = await t.signInAdmin();
    await admin
      .post('/v1/admin/promo-codes')
      .send({
        code: 'OLD',
        kind: 'percent_off',
        percentBps: 5000,
        expiresAt: '2020-01-01T00:00:00Z',
      })
      .expect(201);
    const res = await t
      .http()
      .get('/v1/membership/quote?planCode=annual&promoCode=OLD')
      .expect(400);
    expect(res.body.detail).toBe('expired');
  });

  it('request information sends the applicant back; resubmitting returns to review', async () => {
    const admin = await t.signInAdmin();
    const a = await readyForReview('fay@example.com');
    await admin
      .post(`/v1/admin/applications/${a.advisorId}/decision`)
      .send({ decision: 'request_info' })
      .expect(400);
    await admin
      .post(`/v1/admin/applications/${a.advisorId}/decision`)
      .send({ decision: 'request_info', note: 'Please add your full street address.' })
      .expect(200);
    await t.settle();
    let app = (await a.agent.get('/v1/advisor-application').expect(200)).body;
    expect(app).toMatchObject({
      status: 'applied',
      infoRequestNote: 'Please add your full street address.',
    });
    expect(t.mail.sent.some((m) => m.text.includes('Please add your full street address.'))).toBe(
      true,
    );

    await a.agent
      .post('/v1/advisor-application')
      .send({ ...application, address: { ...application.address, line2: 'Flat 4' } })
      .expect(201);
    app = (await a.agent.get('/v1/advisor-application').expect(200)).body;
    expect(app).toMatchObject({ status: 'under_review', infoRequestNote: null });
  });

  it('rejection is final', async () => {
    const admin = await t.signInAdmin();
    const a = await readyForReview('gus@example.com');
    await admin
      .post(`/v1/admin/applications/${a.advisorId}/decision`)
      .send({ decision: 'reject' })
      .expect(200);
    await a.agent.post('/v1/advisor-application').send(application).expect(409);
    await a.agent
      .post('/v1/membership/checkout')
      .set('Idempotency-Key', key())
      .send({ planCode: 'annual', paymentMethodRef: 'pm_fake_visa' })
      .expect(409);
  });

  it('only admins reach the back office; checkout requires an Idempotency-Key', async () => {
    const a = await t.signUpAdvisor('hal@example.com');
    await a.agent.get('/v1/admin/applications').expect(403);
    await t.http().get('/v1/admin/applications').expect(401);
    await a.agent
      .post('/v1/membership/checkout')
      .send({ planCode: 'annual', paymentMethodRef: 'pm_fake_visa' })
      .expect(400);
  });

  it('de-duplicates provider webhooks and rejects bad signatures', async () => {
    const body = JSON.stringify({ id: 'evt_1', reference: 'kyc_x', outcome: 'passed' });
    await t
      .http()
      .post('/webhooks/fake-kyc')
      .set('content-type', 'application/json')
      .set('x-fake-signature', 'bad')
      .send(body)
      .expect(401);
    const { signFakeWebhook } =
      await import('../src/modules/identity/infrastructure/fake-providers.js');
    const sig = signFakeWebhook(body);
    const first = await t
      .http()
      .post('/webhooks/fake-kyc')
      .set('content-type', 'application/json')
      .set('x-fake-signature', sig)
      .send(body)
      .expect(200);
    const again = await t
      .http()
      .post('/webhooks/fake-kyc')
      .set('content-type', 'application/json')
      .set('x-fake-signature', sig)
      .send(body)
      .expect(200);
    expect(first.body.duplicate).toBe(false);
    expect(again.body.duplicate).toBe(true);
  });

  it('cancelling keeps access to the end of the period (FR-MEM-07)', async () => {
    const admin = await t.signInAdmin();
    const a = await readyForReview('ivy@example.com');
    await a.agent
      .post('/v1/membership/checkout')
      .set('Idempotency-Key', key())
      .send({ planCode: 'quarterly', paymentMethodRef: 'pm_fake_visa' })
      .expect(200);
    await admin
      .post(`/v1/admin/applications/${a.advisorId}/decision`)
      .send({ decision: 'accept' })
      .expect(200);
    await t.settle();
    const m = (await a.agent.post('/v1/membership/cancel').expect(200)).body;
    expect(m).toMatchObject({ status: 'active', cancelAtPeriodEnd: true });
    await t.settle();
    expect(t.mail.sent.some((x) => x.subject === 'Your membership is cancelled')).toBe(true);
  });
});
