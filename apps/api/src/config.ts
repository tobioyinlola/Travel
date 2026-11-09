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
  /** Base URL of the web app, used in emails (verification, proposal links). */
  WEB_BASE_URL: z.string().default('http://localhost:3000'),
  /** 32 random bytes, base64. Dev default is NOT secret; production must set it from the secret store. */
  FIELD_ENCRYPTION_KEY: z.string().default('ZGV2LW9ubHkta2V5LWRvLW5vdC11c2UtaW4tcHJvZCE='),
  SESSION_TTL_HOURS: z.coerce.number().int().positive().default(12),
  /** `fake` wires in-process fakes for KYC, e-signature, billing; `live` requires real provider config. */
  PROVIDERS_MODE: z.enum(['fake', 'live']).default('fake'),
  SMTP_URL: z.string().default('smtp://localhost:1025'),
  MAIL_FROM: z.string().default('Advisor Travel Platform <no-reply@atp.local>'),
  /** Email adapter: smtp (Mailpit locally), memory (tests) or log (prints to stdout; dev without Mailpit). */
  MAIL_TRANSPORT: z.enum(['smtp', 'memory', 'log']).default('smtp'),
  /** How long proposal prices stay valid before they must be re-checked (FR-ITN-05). */
  PROPOSAL_RATE_TTL_HOURS: z.coerce.number().int().positive().default(24),
  /** How long a traveler proposal link works. */
  PROPOSAL_LINK_DAYS: z.coerce.number().int().positive().default(30),
  /**
   * Express "trust proxy": whose X-Forwarded-For to believe for the client IP (rate limits, audit).
   * 'loopback' trusts the web app's server-side requests on the same host; set the load balancer's
   * addresses or hop count in production.
   */
  TRUST_PROXY: z.string().default('loopback'),
  OTEL_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform((v) => v === 'true'),
});

export type AppConfig = z.infer<typeof envSchema>;

const DEV_KEY = 'ZGV2LW9ubHkta2V5LWRvLW5vdC11c2UtaW4tcHJvZCE=';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    throw new Error(`Invalid environment: ${z.prettifyError(parsed.error)}`);
  }
  if (parsed.data.NODE_ENV === 'production') {
    if (parsed.data.FIELD_ENCRYPTION_KEY === DEV_KEY)
      throw new Error('Set FIELD_ENCRYPTION_KEY in production');
    if (parsed.data.PROVIDERS_MODE === 'fake')
      throw new Error('PROVIDERS_MODE=fake is not allowed in production');
    if (parsed.data.MAIL_TRANSPORT !== 'smtp')
      throw new Error('MAIL_TRANSPORT must be smtp in production');
  }
  return parsed.data;
}

export const APP_CONFIG = Symbol('APP_CONFIG');
