import { INestApplication, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import type { AppConfig } from './config.js';
import { correlationMiddleware } from './platform/http/correlation.middleware.js';
import { IdempotencyInterceptor } from './platform/http/idempotency.js';
import { ProblemDetailsFilter } from './platform/http/problem-details.filter.js';

/** Builds the HTTP application (shared by main.web, tests and the OpenAPI export). */
export async function createHttpApp(
  config: AppConfig,
  opts: { logger?: boolean } = {},
): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRole(config, 'web'), {
    logger: opts.logger === false ? false : ['error', 'warn', 'log'],
    bufferLogs: false,
  });
  configureHttpApp(app, config);
  return app;
}

/** Cross-cutting HTTP setup, shared with tests that build their own module graph. */
export function configureHttpApp(
  app: INestApplication,
  config: Pick<AppConfig, 'WEB_ORIGINS'>,
): void {
  app.enableCors({
    origin: config.WEB_ORIGINS.split(',').map((o) => o.trim()),
    credentials: true,
    exposedHeaders: ['x-correlation-id', 'idempotent-replayed'],
  });
  app.use(correlationMiddleware);
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
