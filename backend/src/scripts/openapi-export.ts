import 'reflect-metadata';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadConfig } from '../config.js';
import { buildOpenApi, createHttpApp } from '../http-app.js';

/** Writes backend/openapi.json, from which packages/api-client generates typed clients. */
async function main(): Promise<void> {
  const app = await createHttpApp(loadConfig(), { logger: false });
  const doc = buildOpenApi(app);
  const out = join(import.meta.dirname, '..', '..', 'openapi.json');
  writeFileSync(out, JSON.stringify(doc, null, 2) + '\n');
  await app.close();
  console.log(`wrote ${out}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
