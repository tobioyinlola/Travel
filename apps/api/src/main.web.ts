import 'reflect-metadata';
import { SwaggerModule } from '@nestjs/swagger';
import { loadConfig } from './config.js';
import { buildOpenApi, createHttpApp } from './http-app.js';
import { startTracing } from './platform/observability/tracing.js';

async function main(): Promise<void> {
  const config = loadConfig();
  await startTracing(config.OTEL_ENABLED);
  const app = await createHttpApp(config);
  if (config.NODE_ENV !== 'production') {
    SwaggerModule.setup('docs', app, buildOpenApi(app));
  }
  await app.listen(config.PORT);
  console.log(`api listening on :${config.PORT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
