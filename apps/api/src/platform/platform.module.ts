import {
  DynamicModule,
  Global,
  Inject,
  Module,
  OnApplicationBootstrap,
  OnApplicationShutdown,
  Optional,
} from '@nestjs/common';
import type { Redis } from 'ioredis';
import type { Logger } from 'pino';
import { APP_CONFIG, type AppConfig } from '../config.js';
import { Database } from './db/database.js';
import { EventBus } from './events/event-bus.js';
import { OutboxRelay } from './events/outbox-relay.js';
import { createTxHooks } from './events/tx-hooks.js';
import { HealthController } from './health/health.controller.js';
import { IDEMPOTENCY_TTL_HOURS, IdempotencyInterceptor } from './http/idempotency.js';
import { FeatureFlags } from './feature-flags.js';
import { DeadLetterService } from './jobs/dead-letters.js';
import { JobRegistry } from './jobs/job-registry.js';
import { WorkerRunner, registerEventHandlerJobs } from './jobs/worker-runner.js';
import { PLATFORM } from './modules.js';
import { createLogger } from './observability/logger.js';
import { PlatformJobs } from './platform-jobs.js';
import { createRedis } from './redis.js';
import { AuditWriter } from './audit/audit-writer.js';
import { FieldCrypto } from './security/field-crypto.js';
import { WebhookController, WebhookInbox, WebhookRegistry } from './webhooks/webhooks.js';
import { LOGGER, REDIS } from './tokens.js';

/** web: HTTP API. worker: job runners and outbox relay. cli: one-off scripts (neither). */
export type ProcessRole = 'web' | 'worker' | 'cli';
const PROCESS_ROLE = Symbol('PROCESS_ROLE');

/**
 * Runs the outbox relay loop and the job runners in the worker process only.
 * Event-handler jobs are registered in both processes so the web process can enqueue and list them.
 */
class PlatformLifecycle implements OnApplicationBootstrap, OnApplicationShutdown {
  private relayTimer: NodeJS.Timeout | undefined;
  private stopping = false;

  constructor(
    @Inject(PROCESS_ROLE) private readonly role: ProcessRole,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(LOGGER) private readonly logger: Logger,
    @Inject(REDIS) private readonly redis: Redis,
    private readonly db: Database,
    private readonly bus: EventBus,
    private readonly jobs: JobRegistry,
    private readonly relay: OutboxRelay,
    private readonly runner: WorkerRunner,
    @Optional() private readonly deadLetters?: DeadLetterService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    registerEventHandlerJobs(this.bus, this.jobs, this.db);
    if (this.role !== 'worker') return;
    await this.runner.start({
      concurrency: {
        critical: this.config.WORKER_CONCURRENCY_CRITICAL,
        default: this.config.WORKER_CONCURRENCY_DEFAULT,
        bulk: this.config.WORKER_CONCURRENCY_BULK,
      },
    });
    this.scheduleRelay();
    this.logger.info('worker.started');
  }

  private scheduleRelay(): void {
    if (this.stopping) return;
    this.relayTimer = setTimeout(async () => {
      try {
        await this.relay.drain();
      } catch (err) {
        this.logger.error({ err }, 'outbox.relay_failed');
      }
      this.scheduleRelay();
    }, this.config.OUTBOX_RELAY_INTERVAL_MS);
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopping = true;
    if (this.relayTimer) clearTimeout(this.relayTimer);
    await this.runner.stop();
    await this.deadLetters?.release();
    this.redis.disconnect();
    await this.db.end();
  }
}

@Global()
@Module({})
export class PlatformModule {
  static forRoot(config: AppConfig, role: ProcessRole): DynamicModule {
    return {
      module: PlatformModule,
      controllers: role === 'web' ? [HealthController, WebhookController] : [],
      providers: [
        { provide: APP_CONFIG, useValue: config },
        { provide: PROCESS_ROLE, useValue: role },
        { provide: IDEMPOTENCY_TTL_HOURS, useValue: config.IDEMPOTENCY_TTL_HOURS },
        { provide: LOGGER, useFactory: () => createLogger(config.LOG_LEVEL) },
        { provide: REDIS, useFactory: () => createRedis(config.REDIS_URL) },
        { provide: JobRegistry, useValue: new JobRegistry() },
        { provide: EventBus, useValue: new EventBus() },
        {
          provide: Database,
          inject: [JobRegistry],
          useFactory: (jobs: JobRegistry) => {
            const db = Database.fromUrl(config.DATABASE_URL, config.DATABASE_POOL_MAX);
            db.setHooks(createTxHooks(jobs));
            return db;
          },
        },
        {
          provide: OutboxRelay,
          inject: [Database, EventBus],
          useFactory: (db: Database, bus: EventBus) => new OutboxRelay(db, bus),
        },
        {
          provide: WorkerRunner,
          inject: [Database, JobRegistry, LOGGER],
          useFactory: (db: Database, jobs: JobRegistry, logger: Logger) =>
            new WorkerRunner(db, jobs, logger),
        },
        {
          provide: DeadLetterService,
          inject: [Database],
          useFactory: (db: Database) => new DeadLetterService(db),
        },
        {
          provide: AuditWriter,
          inject: [Database],
          useFactory: (db: Database) => new AuditWriter(db),
        },
        { provide: FieldCrypto, useFactory: () => new FieldCrypto(config.FIELD_ENCRYPTION_KEY) },
        {
          provide: FeatureFlags,
          inject: [Database],
          useFactory: (db: Database) => new FeatureFlags(db),
        },
        WebhookRegistry,
        WebhookInbox,
        IdempotencyInterceptor,
        PlatformJobs,
        PlatformLifecycle,
      ],
      exports: [
        APP_CONFIG,
        LOGGER,
        REDIS,
        Database,
        EventBus,
        JobRegistry,
        DeadLetterService,
        IdempotencyInterceptor,
        AuditWriter,
        FieldCrypto,
        FeatureFlags,
        WebhookRegistry,
        WebhookInbox,
      ],
    };
  }
}

export { PLATFORM };
