import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { newId } from '../../shared-kernel/index.js';
import { Database } from '../../../platform/db/database.js';
import type { Tx } from '../../../platform/db/tx.js';
import { JobRegistry } from '../../../platform/jobs/job-registry.js';
import { findMatch, type Candidate } from '../domain/matching.js';
import { HOTEL_SUPPLIERS, type HotelSupplierPort, type SupplierProperty } from './supplier.port.js';

export interface IngestionStats {
  supplier: string;
  created: number;
  merged: number;
  updated: number;
}

/** FR-INV-01/02: nightly content ingestion into one normalised catalog, merging duplicates across feeds. */
@Injectable()
export class IngestionService implements OnModuleInit {
  constructor(
    private readonly db: Database,
    private readonly jobs: JobRegistry,
    @Inject(HOTEL_SUPPLIERS) private readonly suppliers: HotelSupplierPort[],
  ) {}

  onModuleInit(): void {
    this.jobs.register({
      name: 'catalog.ingest-all',
      module: 'catalog',
      queue: 'bulk',
      cron: '10 1 * * *',
      handle: async () => {
        await this.enqueueAll();
      },
    });
    this.jobs.register<{ supplier: string }>({
      name: 'catalog.ingest-supplier',
      module: 'catalog',
      queue: 'bulk',
      maxAttempts: 3,
      handle: async ({ supplier }) => {
        await this.ingest(supplier);
      },
    });
  }

  async enqueueAll(): Promise<string[]> {
    await this.db.transaction('catalog', async (tx) => {
      for (const s of this.suppliers)
        await tx.enqueue(
          'catalog.ingest-supplier',
          { supplier: s.name },
          { jobKey: `ingest:${s.name}` },
        );
    });
    return this.suppliers.map((s) => s.name);
  }

  async ingest(supplierName: string): Promise<IngestionStats> {
    const supplier = this.suppliers.find((s) => s.name === supplierName);
    if (!supplier) throw new Error(`Unknown supplier ${supplierName}`);
    const runId = newId();
    await this.db.transaction('catalog', (tx) =>
      tx.query(
        `INSERT INTO catalog.ingestion_runs (id, supplier, status) VALUES ($1, $2, 'running')`,
        [runId, supplierName],
      ),
    );
    const stats: IngestionStats = { supplier: supplierName, created: 0, merged: 0, updated: 0 };
    try {
      let cursor: string | null = null;
      do {
        // Fetch outside any transaction (ARCH rule 7); write each page in one transaction.
        const page = await supplier.listContent(cursor);
        await this.db.transaction('catalog', async (tx) => {
          // Suppliers ingest in parallel; matching must see every other supplier's committed hotels, so
          // catalog writes are serialised (otherwise two feeds can both create the same hotel).
          await tx.query(`SELECT pg_advisory_xact_lock(hashtext('catalog.ingest'))`);
          for (const item of page.items) stats[await this.upsert(tx, supplierName, item)] += 1;
        });
        cursor = page.nextCursor;
      } while (cursor);
      await this.db.transaction('catalog', (tx) =>
        tx.query(
          `UPDATE catalog.ingestion_runs SET status = 'succeeded', finished_at = now(), created = $2, merged = $3, updated = $4 WHERE id = $1`,
          [runId, stats.created, stats.merged, stats.updated],
        ),
      );
      return stats;
    } catch (e) {
      await this.db.transaction('catalog', (tx) =>
        tx.query(
          `UPDATE catalog.ingestion_runs SET status = 'failed', finished_at = now(), error = $2 WHERE id = $1`,
          [runId, (e as Error).message],
        ),
      );
      throw e;
    }
  }

  private async upsert(
    tx: Tx,
    supplier: string,
    p: SupplierProperty,
  ): Promise<'created' | 'merged' | 'updated'> {
    const [known] = await tx.query<{ property_id: string }>(
      'SELECT property_id FROM catalog.property_sources WHERE supplier = $1 AND supplier_property_id = $2',
      [supplier, p.supplierPropertyId],
    );
    if (known) {
      await tx.query(
        `UPDATE catalog.property_sources SET name = $3, content = $4, last_seen_at = now() WHERE supplier = $1 AND supplier_property_id = $2`,
        [supplier, p.supplierPropertyId, p.name, JSON.stringify(p)],
      );
      return 'updated';
    }
    // Candidates: same shared id, or anything within ~1 km (exact distance is checked in findMatch).
    const candidates = await tx.query<Candidate & { shared_id: string | null }>(
      `SELECT id, name, lat, lng, shared_id FROM catalog.properties
        WHERE ($1::text IS NOT NULL AND shared_id = $1)
           OR (lat BETWEEN $2 - 0.01 AND $2 + 0.01 AND lng BETWEEN $3 - 0.01 AND $3 + 0.01)`,
      [p.sharedId, p.lat, p.lng],
    );
    const match = findMatch(
      p,
      candidates.map((c) => ({ ...c, sharedId: c.shared_id })),
    );
    let propertyId: string;
    if (match) {
      propertyId = match.id;
      if (p.sharedId) {
        await tx.query(
          'UPDATE catalog.properties SET shared_id = coalesce(shared_id, $2), updated_at = now() WHERE id = $1',
          [propertyId, p.sharedId],
        );
      }
    } else {
      propertyId = newId();
      await tx.query(
        `INSERT INTO catalog.properties (id, name, brand, star_rating, address, city, country_code, lat, lng, amenities, description, photos, shared_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
        [
          propertyId,
          p.name,
          p.brand,
          p.starRating,
          p.address,
          p.city,
          p.countryCode,
          p.lat,
          p.lng,
          p.amenities,
          p.description,
          JSON.stringify(p.photos),
          p.sharedId,
        ],
      );
    }
    await tx.query(
      `INSERT INTO catalog.property_sources (supplier, supplier_property_id, property_id, name, match_reason, content)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        supplier,
        p.supplierPropertyId,
        propertyId,
        p.name,
        match ? match.reason : 'new',
        JSON.stringify(p),
      ],
    );
    return match ? 'merged' : 'created';
  }
}
