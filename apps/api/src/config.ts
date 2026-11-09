import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3001),
  DATABASE_URL: z.string().default('postgres://atp_app:atp_app@localhost:5432/atp'),
  DATABASE_ADMIN_URL: z.string().default('postgres://postgres:postgres@localhost:5432/atp'),
  DATABASE_POOL_MAX: z.coerce.number().int().default(20),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  /** Comma-separated browser origins allowed to call the API with cookies. */
  WEB_ORIGINS: z.string().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  WORKER_CONCURRENCY_CRITICAL: z.coerce.number().int().positive().default(10),
  WORKER_CONCURRENCY_DEFAULT: z.coerce.number().int().positive().default(5),
  WORKER_CONCURRENCY_BULK: z.coerce.number().int().positive().default(2),
  OUTBOX_RELAY_INTERVAL_MS: z.coerce.number().int().positive().default(250),
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().int().positive().default(24),
  OTEL_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${z.prettifyError(parsed.error)}`);
  }
  return parsed.data;
}

export const APP_CONFIG = Symbol('APP_CONFIG');
