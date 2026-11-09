import { Body, Controller, HttpCode, INestApplication, Module, Post } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { loadConfig } from '../src/config.js';
import { configureHttpApp } from '../src/http-app.js';
import { RequireIdempotencyKey } from '../src/platform/http/idempotency.js';
import { PlatformModule } from '../src/platform/platform.module.js';
import { makePlatform, type TestPlatform } from './helpers.js';

let counter = 0;

@Controller({ path: 'test', version: '1' })
class TestController {
  @Post('orders')
  create(@Body() body: unknown) {
    const parsed = z.object({ amount: z.number().int().positive() }).parse(body);
    counter += 1;
    return { orderNo: counter, amount: parsed.amount };
  }

  @Post('payouts')
  @HttpCode(202)
  @RequireIdempotencyKey()
  payout(@Body() body: { amount: number }) {
    counter += 1;
    return { payoutNo: counter, amount: body.amount };
  }
}

@Module({ controllers: [TestController] })
class TestModule {}

@Module({})
class TestRoot {
  static create() {
    return { module: TestRoot, imports: [PlatformModule.forRoot(loadConfig(), 'web'), TestModule] };
  }
}

describe('HTTP conventions', () => {
  let app: INestApplication;
  let p: TestPlatform;

  beforeAll(async () => {
    p = makePlatform();
    app = await NestFactory.create(TestRoot.create(), { logger: false });
    configureHttpApp(app, loadConfig());
    await app.init();
  });

  beforeEach(async () => {
    await p.reset();
  });

  afterAll(async () => {
    await app.close();
    await p.close();
  });

  it('reports health of database and redis', async () => {
    const res = await request(app.getHttpServer()).get('/v1/health').expect(200);
    expect(res.body).toEqual({ status: 'ok', checks: { database: true, redis: true } });
  });

  it('echoes or generates a correlation id', async () => {
    const res = await request(app.getHttpServer())
      .get('/v1/health')
      .set('x-correlation-id', 'abc-123');
    expect(res.headers['x-correlation-id']).toBe('abc-123');
    const gen = await request(app.getHttpServer()).get('/v1/health');
    expect(gen.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('returns problem details for validation errors and unknown routes', async () => {
    const bad = await request(app.getHttpServer())
      .post('/v1/test/orders')
      .send({ amount: -1 })
      .expect(400);
    expect(bad.headers['content-type']).toMatch(/application\/problem\+json/);
    expect(bad.body).toMatchObject({
      title: 'Request validation failed',
      status: 400,
      instance: '/v1/test/orders',
    });
    expect(bad.body.errors[0].path).toBe('amount');
    const missing = await request(app.getHttpServer()).get('/v1/nope').expect(404);
    expect(missing.body).toMatchObject({ title: 'Not Found', status: 404 });
  });

  it('replays the stored result for a retried Idempotency-Key', async () => {
    const first = await request(app.getHttpServer())
      .post('/v1/test/orders')
      .set('Idempotency-Key', 'order-key-0001')
      .send({ amount: 100 })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post('/v1/test/orders')
      .set('Idempotency-Key', 'order-key-0001')
      .send({ amount: 100 })
      .expect(201);
    expect(second.body).toEqual(first.body);
    expect(second.headers['idempotent-replayed']).toBe('true');
  });

  it('rejects the same key with a different body', async () => {
    await request(app.getHttpServer())
      .post('/v1/test/orders')
      .set('Idempotency-Key', 'order-key-0002')
      .send({ amount: 1 });
    const res = await request(app.getHttpServer())
      .post('/v1/test/orders')
      .set('Idempotency-Key', 'order-key-0002')
      .send({ amount: 2 })
      .expect(422);
    expect(res.body.type).toMatch(/idempotency-key-reused/);
  });

  it('releases the key when the request fails so the client can retry', async () => {
    await request(app.getHttpServer())
      .post('/v1/test/orders')
      .set('Idempotency-Key', 'order-key-0003')
      .send({ amount: -5 })
      .expect(400);
    await request(app.getHttpServer())
      .post('/v1/test/orders')
      .set('Idempotency-Key', 'order-key-0003')
      .send({ amount: -5 })
      .expect(400);
  });

  it('requires a key on money endpoints and keeps the custom status on replay', async () => {
    await request(app.getHttpServer()).post('/v1/test/payouts').send({ amount: 5 }).expect(400);
    const a = await request(app.getHttpServer())
      .post('/v1/test/payouts')
      .set('Idempotency-Key', 'payout-key-01')
      .send({ amount: 5 })
      .expect(202);
    const b = await request(app.getHttpServer())
      .post('/v1/test/payouts')
      .set('Idempotency-Key', 'payout-key-01')
      .send({ amount: 5 })
      .expect(202);
    expect(b.body).toEqual(a.body);
  });
});
