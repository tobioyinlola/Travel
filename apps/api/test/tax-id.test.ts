import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { application, startApp, type TestApp } from './app-harness.js';

describe('tax identifier at application (field-encrypted)', () => {
  let t: TestApp;
  beforeAll(async () => {
    t = await startApp();
  });
  beforeEach(() => t.reset());
  afterAll(() => t.close());

  it('is stored encrypted, shown only as its last four characters, and never reaches the audit log', async () => {
    const since = new Date(Date.now() - 1000);
    const a = await t.signUpAdvisor('ada@example.com');
    const res = await a.agent
      .post('/v1/advisor-application')
      .send({ ...application, taxId: 'NG-1234-5678-9012' })
      .expect(201);
    expect(res.body.taxId).toEqual({ provided: true, last4: '9012' });
    expect(JSON.stringify(res.body)).not.toContain('1234-5678');

    const row = (
      await t.admin.query(
        `SELECT tax_id_enc, tax_id_last4 FROM identity.advisors WHERE user_id = $1`,
        [a.userId],
      )
    ).rows[0];
    expect(row.tax_id_last4).toBe('9012');
    expect(row.tax_id_enc).toBeTruthy();
    expect(row.tax_id_enc).not.toContain('1234');

    const audit = await t.admin.query(
      `SELECT before::text AS b, after::text AS a FROM audit.log WHERE module = 'identity' AND occurred_at >= $1`,
      [since],
    );
    expect(JSON.stringify(audit.rows)).not.toMatch(/1234|9012|taxId/);

    // Resubmitting without it keeps the stored value; a bad value is refused.
    const again = await a.agent.post('/v1/advisor-application').send(application).expect(201);
    expect(again.body.taxId).toEqual({ provided: true, last4: '9012' });
    await a.agent
      .post('/v1/advisor-application')
      .send({ ...application, taxId: '<script>' })
      .expect(400);
  });

  it('is optional', async () => {
    const a = await t.signUpAdvisor('bob@example.com');
    const res = await a.agent.post('/v1/advisor-application').send(application).expect(201);
    expect(res.body.taxId).toEqual({ provided: false, last4: null });
  });
});
