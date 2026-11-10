import {
  VERSION_NEUTRAL,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Injectable,
  OnModuleInit,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiExcludeController } from '@nestjs/swagger';
import type { Request } from 'express';
import { newId } from '../../modules/shared-kernel/index.js';
import { Database } from '../db/database.js';
import type { Tx } from '../db/tx.js';
import { Public } from '../http/auth.js';
import { ProblemException, problemType } from '../http/problem.js';
import { JobRegistry } from '../jobs/job-registry.js';
import { PLATFORM } from '../modules.js';

export interface VerifiedWebhook {
  /** Provider's unique event id, used to de-duplicate redeliveries. */
  eventId: string;
  type: string;
  payload: unknown;
}

export interface WebhookProvider {
  /** URL segment: POST /webhooks/<name>. */
  name: string;
  /** Module whose role processes the event. */
  module: string;
  /** Verify the signature against the raw body; throw if invalid. Must not do I/O. */
  verify(headers: Record<string, string | string[] | undefined>, rawBody: Buffer): VerifiedWebhook;
  /** Process asynchronously in a transaction under `module`'s role. */
  handle(event: VerifiedWebhook, tx: Tx): Promise<void>;
}

@Injectable()
export class WebhookRegistry {
  private readonly providers = new Map<string, WebhookProvider>();

  register(provider: WebhookProvider): void {
    if (this.providers.has(provider.name))
      throw new Error(`Webhook provider already registered: ${provider.name}`);
    this.providers.set(provider.name, provider);
  }

  get(name: string): WebhookProvider | undefined {
    return this.providers.get(name);
  }
}

/**
 * Inbound webhook pipeline (ARCH "Resilience patterns"): verify signature, store raw payload, acknowledge
 * fast, process asynchronously, de-duplicate by provider event id.
 */
@Injectable()
export class WebhookInbox implements OnModuleInit {
  constructor(
    private readonly db: Database,
    private readonly registry: WebhookRegistry,
    private readonly jobs: JobRegistry,
  ) {}

  onModuleInit(): void {
    this.jobs.register<{ inboxId: string }>({
      name: 'platform.webhook-process',
      module: PLATFORM,
      queue: 'critical',
      handle: ({ inboxId }) => this.process(inboxId),
    });
  }

  /** Returns false when the event was already received (redelivery). */
  async receive(providerName: string, headers: VerifiedHeaders, rawBody: Buffer): Promise<boolean> {
    const provider = this.registry.get(providerName);
    if (!provider)
      throw new ProblemException(
        HttpStatus.NOT_FOUND,
        problemType('unknown-webhook'),
        'Unknown webhook',
      );
    let event: VerifiedWebhook;
    try {
      event = provider.verify(headers, rawBody);
    } catch {
      throw new ProblemException(
        HttpStatus.UNAUTHORIZED,
        problemType('bad-signature'),
        'Invalid webhook signature',
      );
    }
    return this.db.transaction(PLATFORM, async (tx) => {
      const id = newId();
      const inserted = await tx.query(
        `INSERT INTO platform.webhook_inbox (id, provider, event_id, event_type, payload, raw_body)
         VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (provider, event_id) DO NOTHING RETURNING id`,
        [
          id,
          provider.name,
          event.eventId,
          event.type,
          JSON.stringify(event.payload),
          rawBody.toString('utf8'),
        ],
      );
      if (inserted.length === 0) return false;
      await tx.enqueue('platform.webhook-process', { inboxId: id });
      return true;
    });
  }

  private async process(inboxId: string): Promise<void> {
    const [row] = await this.db.read<{
      provider: string;
      event_id: string;
      event_type: string;
      payload: unknown;
      processed_at: Date | null;
    }>(
      PLATFORM,
      'SELECT provider, event_id, event_type, payload, processed_at FROM platform.webhook_inbox WHERE id = $1',
      [inboxId],
    );
    if (!row || row.processed_at) return;
    const provider = this.registry.get(row.provider);
    if (!provider) throw new Error(`No handler for webhook provider ${row.provider}`);
    await this.db.transaction(provider.module, async (tx) => {
      await provider.handle(
        { eventId: row.event_id, type: row.event_type, payload: row.payload },
        tx,
      );
      await this.db.transaction(PLATFORM, (ptx) =>
        ptx.query('UPDATE platform.webhook_inbox SET processed_at = now() WHERE id = $1', [
          inboxId,
        ]),
      );
    });
  }
}

type VerifiedHeaders = Record<string, string | string[] | undefined>;

@ApiExcludeController()
// Webhooks live at /webhooks/<provider> (no /v1), per the ARCH API table.
@Controller({ path: 'webhooks', version: VERSION_NEUTRAL })
export class WebhookController {
  constructor(@Inject(WebhookInbox) private readonly inbox: WebhookInbox) {}

  @Post(':provider')
  @Public()
  @HttpCode(HttpStatus.OK)
  async receive(@Param('provider') provider: string, @Req() req: Request & { rawBody?: Buffer }) {
    const raw = req.rawBody ?? Buffer.from(JSON.stringify(req.body ?? {}));
    const fresh = await this.inbox.receive(provider, req.headers, raw);
    return { received: true, duplicate: !fresh };
  }
}
