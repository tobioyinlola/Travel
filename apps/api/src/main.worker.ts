import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { loadConfig } from './config.js';
import { startTracing } from './platform/observability/tracing.js';

/** Same image and code as the web process, different entry point (ARCH "Background jobs"). */
async function main(): Promise<void> {
  const config = loadConfig();
  await startTracing(config.OTEL_ENABLED);
  const app = await NestFactory.createApplicationContext(AppModule.forRole(config, 'worker'));
  app.enableShutdownHooks();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
