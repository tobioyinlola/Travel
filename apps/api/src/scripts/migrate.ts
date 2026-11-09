import { loadConfig } from '../config.js';
import { migrate } from '../platform/migrations/runner.js';

async function main(): Promise<void> {
  const config = loadConfig();
  await migrate({ adminUrl: config.DATABASE_ADMIN_URL, appUrl: config.DATABASE_URL });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
