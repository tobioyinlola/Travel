import swc from 'unplugin-swc';
import { defineConfig } from 'vitest/config';

const TEST_DB = process.env.TEST_DATABASE_NAME ?? 'atp_test';
const PG_HOST = process.env.PGHOST ?? 'localhost';

export default defineConfig({
  // SWC keeps decorator metadata, which NestJS dependency injection needs.
  plugins: [swc.vite({ module: { type: 'es6' } })],
  test: {
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    environment: 'node',
    globalSetup: ['test/global-setup.ts'],
    // Integration tests share one database; run files one at a time.
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL:
        process.env.TEST_DATABASE_URL ?? `postgres://atp_app:atp_app@${PG_HOST}:5432/${TEST_DB}`,
      DATABASE_ADMIN_URL:
        process.env.TEST_DATABASE_ADMIN_URL ??
        `postgres://postgres:postgres@${PG_HOST}:5432/${TEST_DB}`,
      REDIS_URL: process.env.TEST_REDIS_URL ?? 'redis://localhost:6379/1',
      MAIL_TRANSPORT: 'memory',
      PROVIDERS_MODE: 'fake',
    },
  },
});
