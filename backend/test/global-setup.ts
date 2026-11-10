import { Client } from 'pg';
import { migrate } from '../src/platform/migrations/runner.js';

/** Creates the test database if needed and applies all migrations once per test run. */
export default async function setup(): Promise<void> {
  const adminUrl =
    process.env.TEST_DATABASE_ADMIN_URL ?? 'postgres://postgres:postgres@localhost:5432/atp_test';
  const appUrl =
    process.env.TEST_DATABASE_URL ?? 'postgres://atp_app:atp_app@localhost:5432/atp_test';
  const dbName = new URL(adminUrl).pathname.slice(1);
  const server = new URL(adminUrl);
  server.pathname = '/postgres';
  const c = new Client({ connectionString: server.toString() });
  await c.connect();
  const exists = await c.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
  if (exists.rowCount === 0) await c.query(`CREATE DATABASE "${dbName}"`);
  await c.end();
  await migrate({ adminUrl, appUrl, log: () => undefined });
}
