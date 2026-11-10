import { createHash } from 'node:crypto';
import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Database } from '../../../platform/db/database.js';
import type { Tx } from '../../../platform/db/tx.js';
import { EventBus } from '../../../platform/events/event-bus.js';
import { JobRegistry } from '../../../platform/jobs/job-registry.js';
import { CatalogApi } from '../../catalog/index.js';
import { ClientsApi } from '../../clients/index.js';
import { LearningApi } from '../../learning/index.js';
import { PartnersApi } from '../../partners/index.js';
import { newId } from '../../shared-kernel/index.js';
import { sanitizeUntrusted } from '../domain/sanitize.js';
import { MODEL_PORT, type ModelPort } from './model.port.js';

const NO_OWNER = '00000000-0000-0000-0000-000000000000';

interface DocInput {
  sourceType: 'catalog' | 'partner' | 'content' | 'client';
  sourceRef: string;
  ownerAdvisorId: string | null;
  title: string;
  body: string;
}

/**
 * Builds the assistant's knowledge base (FR-AI-01): catalog content, partner programs and course content are shared;
 * an advisor's client notes are indexed for that advisor alone (FR-AI-08, AC-10). Supplier-supplied text is
 * sanitised first (prompt-injection filtering). Indexing is a bulk job; nothing here runs in a request.
 */
@Injectable()
export class IndexerService implements OnModuleInit {
  private readonly logger = new Logger('AiIndexer');

  constructor(
    private readonly db: Database,
    private readonly bus: EventBus,
    private readonly jobs: JobRegistry,
    private readonly catalog: CatalogApi,
    private readonly partners: PartnersApi,
    private readonly learning: LearningApi,
    private readonly clients: ClientsApi,
    @Inject(MODEL_PORT) private readonly model: ModelPort,
  ) {}

  onModuleInit(): void {
    this.jobs.register<Record<string, never>>({
      name: 'ai.index-shared',
      module: 'ai',
      queue: 'bulk',
      cron: '45 3 * * *',
      handle: async () => {
        const n = await this.indexShared();
        this.logger.log(`Indexed ${n} shared documents`);
      },
    });
    // A partner program changed: refresh its document straight away so perks are never stale.
    this.bus.subscribe({
      module: 'ai',
      handler: 'ai.reindexPartnerProgram',
      event: 'PartnerProgramChanged',
      version: 1,
      queue: 'bulk',
      handle: async () => {
        await this.indexPartners();
      },
    });
  }

  private async upsert(tx: Tx, d: DocInput): Promise<boolean> {
    const { text, flagged } = sanitizeUntrusted(d.body);
    if (!text) return false;
    const hash = createHash('sha256').update(`${d.title}\n${text}`).digest('hex');
    const [existing] = await tx.query<{ content_hash: string }>(
      `SELECT content_hash FROM ai.documents WHERE source_type = $1 AND source_ref = $2
          AND coalesce(owner_advisor_id, $3::uuid) = coalesce($4::uuid, $3::uuid)`,
      [d.sourceType, d.sourceRef, NO_OWNER, d.ownerAdvisorId],
    );
    if (existing?.content_hash === hash) return false; // unchanged: skip the embedding call
    const [embedding] = await this.model.embed([`${d.title}. ${text}`]);
    await tx.query(
      `INSERT INTO ai.documents (id, source_type, source_ref, owner_advisor_id, title, body, flagged, content_hash, embedding)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (source_type, source_ref, coalesce(owner_advisor_id, '${NO_OWNER}'::uuid))
       DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body, flagged = EXCLUDED.flagged,
                     content_hash = EXCLUDED.content_hash, embedding = EXCLUDED.embedding, updated_at = now()`,
      [
        newId(),
        d.sourceType,
        d.sourceRef,
        d.ownerAdvisorId,
        d.title,
        text,
        flagged,
        hash,
        embedding,
      ],
    );
    return true;
  }

  private system<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction('ai', async (tx) => {
      await tx.setLocal('atp.scope', 'all');
      return fn(tx);
    });
  }

  /** Shared knowledge: catalog, partner programs, course content. Returns how many documents changed. */
  async indexShared(): Promise<number> {
    let changed = 0;
    for (let offset = 0; ; offset += 100) {
      const page = await this.catalog.listProperties(offset, 100);
      if (page.length === 0) break;
      await this.system(async (tx) => {
        for (const p of page)
          if (
            await this.upsert(tx, {
              sourceType: 'catalog',
              sourceRef: p.id,
              ownerAdvisorId: null,
              title: p.name,
              body: `${p.name} is a ${p.starRating}-star hotel in ${p.city}, ${p.countryCode}. ${p.description} Amenities: ${p.amenities.join(', ')}. Address: ${p.address}.`,
            })
          )
            changed += 1;
      });
    }
    changed += await this.indexPartners();
    const lessons = await this.learning.lessonsForIndex();
    await this.system(async (tx) => {
      for (const l of lessons)
        if (
          await this.upsert(tx, {
            sourceType: 'content',
            sourceRef: l.id,
            ownerAdvisorId: null,
            title: `${l.course}: ${l.title}`,
            body: l.body,
          })
        )
          changed += 1;
    });
    return changed;
  }

  async indexPartners(): Promise<number> {
    const programs = await this.partners.listPrograms();
    let changed = 0;
    const names = new Map<string, string>();
    for (const p of programs) {
      if (!p.effective) continue;
      for (const id of p.propertyIds)
        if (!names.has(id)) names.set(id, (await this.catalog.getProperty(id))?.name ?? '');
    }
    await this.system(async (tx) => {
      for (const p of programs) {
        if (!p.effective) {
          await tx.query(
            `DELETE FROM ai.documents WHERE source_type = 'partner' AND source_ref = $1`,
            [p.id],
          );
          continue;
        }
        const props = p.propertyIds
          .map((id) => names.get(id))
          .filter(Boolean)
          .join(', ');
        const perks = p.perks.map((x: { description: string }) => x.description).join('. ');
        const body = `${p.name} is a ${p.tier} partner program of ${p.supplierName}. ${p.description} Perks: ${perks}. Hotels: ${props}.`;
        if (
          await this.upsert(tx, {
            sourceType: 'partner',
            sourceRef: p.id,
            ownerAdvisorId: null,
            title: p.name,
            body,
          })
        )
          changed += 1;
      }
    });
    return changed;
  }

  /**
   * Re-reads this advisor's client notes. Done before every retrieval that may use them, so an erased or archived
   * client disappears from the index at once (FR-CRM-08), and one advisor's notes never reach another (AC-10).
   */
  async refreshClientDocs(advisorId: string): Promise<void> {
    const profiles = await this.clients.profilesForAi(advisorId);
    await this.system(async (tx) => {
      for (const p of profiles)
        await this.upsert(tx, {
          sourceType: 'client',
          sourceRef: p.id,
          ownerAdvisorId: advisorId,
          title: `Client ${p.name}`,
          body: `${p.name}. ${p.text}`,
        });
      await tx.query(
        `DELETE FROM ai.documents WHERE source_type = 'client' AND owner_advisor_id = $1 AND NOT (source_ref = ANY($2::text[]))`,
        [advisorId, profiles.map((p) => p.id)],
      );
    });
  }

  async removeClientDocs(advisorId: string): Promise<void> {
    await this.system((tx) =>
      tx.query(`DELETE FROM ai.documents WHERE source_type = 'client' AND owner_advisor_id = $1`, [
        advisorId,
      ]),
    );
  }

  embed(text: string) {
    return this.model.embed([text]).then((r) => r[0]!);
  }
}
