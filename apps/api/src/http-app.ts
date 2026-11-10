import { INestApplication, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config.js';
import { MetricsRegistry } from './platform/metrics.js';
import { correlationMiddleware } from './platform/http/correlation.middleware.js';
import { IdempotencyInterceptor } from './platform/http/idempotency.js';
import { securityHeaders } from './platform/http/security-headers.js';
import { originCheck } from './platform/http/origin-check.middleware.js';
import { ProblemDetailsFilter } from './platform/http/problem-details.filter.js';

/** Builds the HTTP application (shared by main.web, tests and the OpenAPI export). */
export async function createHttpApp(
  config: AppConfig,
  opts: { logger?: boolean } = {},
): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRole(config, 'web'), {
    logger: opts.logger === false ? ['error'] : ['error', 'warn', 'log'],
    bufferLogs: false,
    // Raw body is kept for webhook signature verification.
    rawBody: true,
    // Throw startup errors (with their message) instead of calling process.abort().
    abortOnError: false,
  });
  configureHttpApp(app, config);
  return app;
}

/** Cross-cutting HTTP setup, shared with tests that build their own module graph. */
export function configureHttpApp(
  app: INestApplication,
  config: Pick<AppConfig, 'WEB_ORIGINS'> & Partial<Pick<AppConfig, 'NODE_ENV'>>,
): void {
  const origins = config.WEB_ORIGINS.split(',').map((o) => o.trim());
  app.enableCors({
    origin: origins,
    credentials: true,
    exposedHeaders: ['x-correlation-id', 'idempotent-replayed'],
  });
  app.getHttpAdapter().getInstance().disable?.('x-powered-by');
  app.use(securityHeaders({ production: config.NODE_ENV === 'production' }));
  // Statement imports and CSV pastes are larger than Express's 100 kb default, but never need more than this.
  (app as unknown as NestExpressApplication).useBodyParser('json', { limit: '1mb' });
  // Message attachments arrive as raw file bytes (PDF, PNG, JPEG only), capped a little above the 5 MB file limit.
  (app as unknown as NestExpressApplication).useBodyParser('raw', {
    limit: '5600kb',
    type: ['application/pdf', 'image/png', 'image/jpeg'],
  });
  app.use(app.get(MetricsRegistry).middleware());
  app.use(correlationMiddleware);
  app.use(cookieParser());
  app.use(originCheck(origins));
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
  app.useGlobalFilters(new ProblemDetailsFilter());
  app.useGlobalInterceptors(app.get(IdempotencyInterceptor));
  app.enableShutdownHooks();
}

export function buildOpenApi(app: INestApplication): OpenAPIObject {
  const doc = new DocumentBuilder()
    .setTitle('Advisor Travel Platform API')
    .setVersion('1')
    .setDescription(
      'Versioned REST API for the advisor portal, admin console and traveler link pages.',
    )
    .addCookieAuth('atp_session')
    .build();
  return SwaggerModule.createDocument(app, doc);
}
