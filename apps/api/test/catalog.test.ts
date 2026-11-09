import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { inDays, startApp, type TestApp } from './app-harness.js';

describe('catalog: ingestion, search and rates (FR-INV-01/02/04/05/06)', () => {
  let t: TestApp;
  let agent: Awaited<ReturnType<TestApp['onboardAdvisor']>>['agent'];
  const stay = {
    destination: 'lisbon',
    checkIn: inDays(40),
    checkOut: inDays(43),
    adults: 2,
    currency: 'USD',
  };

  beforeAll(async () => {
    t = await startApp();
    await t.admin.query(
      'TRUNCATE catalog.property_sources, catalog.properties, catalog.ingestion_runs',
    );
    await t.ingestCatalog();
  });
  beforeEach(async () => {
    await t.reset();
    agent = (await t.onboardAdvisor('ada@example.com')).agent;
  });
  afterAll(() => t.close());

  async function clearRateCache(): Promise<void> {
    const keys = await t.redis.keys('rates:*');
    if (keys.length) await t.redis.del(...keys);
  }

  it('ingests two overlapping feeds into one catalog without duplicates (FR-INV-02)', async () => {
    const { rows: runs } = await t.admin.query(
      `SELECT supplier, created, merged FROM catalog.ingestion_runs ORDER BY supplier`,
    );
    expect(runs).toEqual([
      { supplier: 'fake-wholesaler-a', created: 40, merged: 0 },
      { supplier: 'fake-wholesaler-b', created: 8, merged: 24 },
    ]);
    const { rows } = await t.admin.query(
      `SELECT match_reason, count(*)::int AS n FROM catalog.property_sources GROUP BY 1 ORDER BY 1`,
    );
    expect(rows).toEqual([
      { match_reason: 'location_and_name', n: 8 },
      { match_reason: 'new', n: 48 },
      { match_reason: 'shared_id', n: 16 },
    ]);
    // Re-running is idempotent.
    await t.ingestCatalog();
    expect(
      (await t.admin.query('SELECT count(*)::int AS n FROM catalog.properties')).rows[0].n,
    ).toBe(48);
  });

  it('searches a destination and returns live rates with taxes, fees, policy and commission', async () => {
    const res = (await agent.get('/v1/catalog/search').query(stay).expect(200)).body;
    expect(res.nights).toBe(3);
    expect(res.results.length).toBe(6);
    const r = res.results[0].rates[0];
    expect(r).toMatchObject({
      checkIn: stay.checkIn,
      checkOut: stay.checkOut,
      nights: 3,
      occupancy: { adults: 2, childrenAges: [] },
    });
    expect(BigInt(r.total.amountMinor)).toBeGreaterThan(BigInt(r.taxes.amountMinor));
    expect(r.feesAtHotel.amountMinor).toBe('2400'); // Lisbon city tax: 4.00 x 2 adults x 3 nights
    expect(r.cancellationPolicy).toBeTruthy();
    expect(r.commissionBps).toBeGreaterThan(0);
    // A merged property gets offers from both suppliers.
    const suppliersPerProperty = res.results.map(
      (x: { rates: Array<{ supplier: string }> }) => new Set(x.rates.map((y) => y.supplier)).size,
    );
    expect(Math.max(...suppliersPerProperty)).toBe(2);
  });

  it('filters by budget, stars and amenities, and sizes rooms to the party', async () => {
    const all = (await agent.get('/v1/catalog/search').query(stay).expect(200)).body;
    const cheapest = BigInt(
      all.results
        .map((x: { fromNightly: { amountMinor: string } }) => x.fromNightly.amountMinor)
        .sort((a: string, b: string) => Number(BigInt(a) - BigInt(b)))[0],
    );
    const capped = (
      await agent
        .get('/v1/catalog/search')
        .query({ ...stay, maxNightly: String(cheapest) })
        .expect(200)
    ).body;
    for (const r of capped.results)
      for (const rate of r.rates)
        expect(BigInt(rate.nightlyAverage.amountMinor)).toBeLessThanOrEqual(cheapest);
    const fiveStar = (
      await agent
        .get('/v1/catalog/search')
        .query({ ...stay, minStars: 5 })
        .expect(200)
    ).body;
    for (const r of fiveStar.results) expect(r.property.starRating).toBe(5);
    const family = (
      await agent
        .get('/v1/catalog/search')
        .query({ ...stay, adults: 2, childrenAges: '7,4,1' })
        .expect(200)
    ).body;
    for (const r of family.results)
      for (const rate of r.rates) expect(rate.maxOccupancy).toBeGreaterThanOrEqual(5);
  });

  it('rejects bad dates and unknown destinations', async () => {
    await agent
      .get('/v1/catalog/search')
      .query({ ...stay, checkIn: inDays(-1) })
      .expect(400);
    await agent
      .get('/v1/catalog/search')
      .query({ ...stay, checkOut: stay.checkIn })
      .expect(400);
    await agent
      .get('/v1/catalog/search')
      .query({ ...stay, destination: 'atlantis' })
      .expect(400);
  });

  it('degrades when one supplier is down, and opens its circuit after repeated failures (ARCH resilience)', async () => {
    t.suppliers[1]!.failing = true;
    for (let i = 0; i < 5; i++) {
      const res = (
        await agent
          .get('/v1/catalog/search')
          .query({
            ...stay,
            adults: 1 + (i % 2),
            checkIn: inDays(50 + i),
            checkOut: inDays(52 + i),
          })
          .expect(200)
      ).body;
      expect(res.warnings).toEqual([{ supplier: 'fake-wholesaler-b', reason: 'did_not_respond' }]);
      expect(res.results.length).toBeGreaterThan(0);
    }
    const open = (
      await agent
        .get('/v1/catalog/search')
        .query({ ...stay, checkIn: inDays(70), checkOut: inDays(71) })
        .expect(200)
    ).body;
    expect(open.warnings).toEqual([
      { supplier: 'fake-wholesaler-b', reason: 'temporarily_unavailable' },
    ]);
  });

  it('times out a hanging supplier instead of waiting', async () => {
    t.suppliers[0]!.hangMs = 4000;
    const started = Date.now();
    const res = (
      await agent
        .get('/v1/catalog/search')
        .query({ ...stay, checkIn: inDays(80), checkOut: inDays(81) })
        .expect(200)
    ).body;
    expect(Date.now() - started).toBeLessThan(3500);
    expect(res.warnings[0]).toMatchObject({ supplier: 'fake-wholesaler-a' });
  }, 15000);

  it('re-checks a rate live and notices a price change (FR-BKG-01, FR-ITN-05)', async () => {
    const res = (await agent.get('/v1/catalog/search').query(stay).expect(200)).body;
    const rate = res.results[0].rates[0];
    const same = (
      await agent
        .post('/v1/catalog/rates/check')
        .send({ rateKey: rate.rateKey, currency: 'USD' })
        .expect(200)
    ).body;
    expect(same.rate.total).toEqual(rate.total);
    for (const s of t.suppliers) s.priceEpoch = 1;
    const moved = (
      await agent
        .post('/v1/catalog/rates/check')
        .send({ rateKey: rate.rateKey, currency: 'USD' })
        .expect(200)
    ).body;
    expect(BigInt(moved.rate.total.amountMinor)).toBeGreaterThan(BigInt(rate.total.amountMinor));
    // The cached search still shows the old price; only the live check sees the change.
    const cached = (await agent.get('/v1/catalog/search').query(stay).expect(200)).body;
    expect(cached.results[0].rates[0].checkedAt).toBe(rate.checkedAt);
  });

  it('marks preferred partner properties and eligible rates once a program is created (FR-INV-06, FR-PRT-01)', async () => {
    const res = (await agent.get('/v1/catalog/search').query(stay).expect(200)).body;
    const target = res.results[res.results.length - 1].property;
    const admin = await t.admin1();
    const props = (
      await admin
        .get('/v1/admin/catalog/properties')
        .query({ q: target.name.slice(0, 12) })
        .expect(200)
    ).body;
    expect(props.map((p: { id: string }) => p.id)).toContain(target.id);
    const supplier = (
      await admin
        .post('/v1/admin/partners/suppliers')
        .send({ name: 'Harbour Hotels Group', type: 'hotel_group' })
        .expect(201)
    ).body;
    const program = (
      await admin
        .post('/v1/admin/partners/programs')
        .send({
          supplierId: supplier.id,
          name: 'Harbour Preferred',
          tier: 'preferred',
          perks: [
            { kind: 'breakfast', description: 'Daily breakfast for two' },
            { kind: 'upgrade', description: 'Room upgrade on arrival, subject to availability' },
          ],
          rateCodes: ['ADV'],
          propertyIds: [target.id],
        })
        .expect(201)
    ).body;
    expect(program).toMatchObject({ effective: true, propertyIds: [target.id], version: 1 });
    await t.settle();

    await clearRateCache(); // new search, not the cached one
    const after = (await agent.get('/v1/catalog/search').query(stay).expect(200)).body;
    expect(after.results[0].property.id).toBe(target.id); // recommended sort puts preferred first
    expect(after.results[0].preferred).toMatchObject({
      programName: 'Harbour Preferred',
      perks: expect.arrayContaining([expect.objectContaining({ kind: 'breakfast' })]),
    });
    for (const r of after.results[0].rates)
      expect(r.partnerEligible).toBe(r.rateCodes.includes('ADV'));
    const onlyPreferred = (
      await agent
        .get('/v1/catalog/search')
        .query({ ...stay, preferredOnly: 'true' })
        .expect(200)
    ).body;
    expect(onlyPreferred.results).toHaveLength(1);

    await admin
      .patch(`/v1/admin/partners/programs/${program.id}`)
      .send({ version: 1, active: false })
      .expect(200);
    await admin
      .patch(`/v1/admin/partners/programs/${program.id}`)
      .send({ version: 1, active: true })
      .expect(409);
    await t.settle();
    await clearRateCache();
    const off = (
      await agent
        .get('/v1/catalog/search')
        .query({ ...stay, preferredOnly: 'true' })
        .expect(200)
    ).body;
    expect(off.results).toHaveLength(0);
  });

  it('meets the search latency objective with headroom (NFR-01: p95 under 3 s)', async () => {
    const times: number[] = [];
    for (let i = 0; i < 20; i++) {
      await clearRateCache();
      const started = Date.now();
      await agent
        .get('/v1/catalog/search')
        .query({ ...stay, destination: ['lisbon', 'paris', 'bali', 'lagos'][i % 4] })
        .expect(200);
      times.push(Date.now() - started);
    }
    times.sort((a, b) => a - b);
    expect(times[Math.ceil(times.length * 0.95) - 1]).toBeLessThan(3000);
  });

  it('is for members only', async () => {
    const applicant = await t.signUpAdvisor('new@example.com');
    await applicant.agent.get('/v1/catalog/search').query(stay).expect(403);
  });
});
