import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import { newId } from '../../shared-kernel/index.js';
import { AuditWriter } from '../../../platform/audit/audit-writer.js';
import { Database } from '../../../platform/db/database.js';
import type { Tx } from '../../../platform/db/tx.js';
import { ProblemException, problemType } from '../../../platform/http/problem.js';
import { JobRegistry } from '../../../platform/jobs/job-registry.js';

export const PERK_KINDS = [
  'upgrade',
  'breakfast',
  'credit',
  'early_check_in',
  'late_check_out',
  'amenity',
  'other',
] as const;
export type PerkKind = (typeof PERK_KINDS)[number];

export interface ProgramInput {
  supplierId: string;
  name: string;
  tier: 'preferred' | 'luxury' | 'exclusive';
  description?: string | undefined;
  perks: Array<{ kind: PerkKind; description: string }>;
  rateCodes: string[];
  propertyIds: string[];
  active?: boolean | undefined;
  validFrom?: string | null | undefined;
  validTo?: string | null | undefined;
}

interface ProgramRow {
  id: string;
  supplier_id: string;
  supplier_name: string;
  name: string;
  tier: ProgramInput['tier'];
  description: string;
  perks: ProgramInput['perks'];
  rate_codes: string[];
  active: boolean;
  valid_from: string | null;
  valid_to: string | null;
  property_ids: string[];
  version: number;
  effective: boolean;
}

const problem = (status: HttpStatus, slug: string, title: string, detail?: string) =>
  new ProblemException(status, problemType(slug), title, detail);

const PROGRAM_SELECT = `
  SELECT p.*, to_char(p.valid_from, 'YYYY-MM-DD') AS valid_from, to_char(p.valid_to, 'YYYY-MM-DD') AS valid_to,
         s.name AS supplier_name,
         coalesce((SELECT array_agg(pp.property_id) FROM partners.program_properties pp WHERE pp.program_id = p.id), '{}') AS property_ids,
         (p.active AND (p.valid_from IS NULL OR p.valid_from <= current_date) AND (p.valid_to IS NULL OR p.valid_to >= current_date)) AS effective
    FROM partners.programs p JOIN partners.suppliers s ON s.id = p.supplier_id`;

/** FR-PRT-01: partner programs with perks, rate codes and eligible properties. */
@Injectable()
export class PartnersService implements OnModuleInit {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditWriter,
    private readonly jobs: JobRegistry,
  ) {}

  onModuleInit(): void {
    // Programs start and end on dates: re-announce any whose effective state changes today.
    this.jobs.register({
      name: 'partners.announce-validity-changes',
      module: 'partners',
      queue: 'default',
      cron: '1 0 * * *',
      handle: async () => {
        await this.db.transaction('partners', async (tx) => {
          const rows = await tx.query<{ id: string }>(
            `SELECT id FROM partners.programs WHERE valid_from = current_date OR valid_to = current_date - 1`,
          );
          for (const r of rows) await this.announce(tx, r.id);
        });
      },
    });
  }

  async listSuppliers() {
    return this.db.read<{
      id: string;
      name: string;
      type: string;
      commissionTerms: string;
      payoutTerms: string;
    }>(
      'partners',
      `SELECT id, name, type, commission_terms AS "commissionTerms", payout_terms AS "payoutTerms" FROM partners.suppliers ORDER BY name`,
    );
  }

  async createSupplier(
    actorId: string,
    input: {
      name: string;
      type: string;
      commissionTerms?: string | undefined;
      payoutTerms?: string | undefined;
    },
  ) {
    const id = newId();
    await this.db.transaction('partners', async (tx) => {
      try {
        await tx.query(
          `INSERT INTO partners.suppliers (id, name, type, commission_terms, payout_terms) VALUES ($1, $2, $3, $4, $5)`,
          [id, input.name, input.type, input.commissionTerms ?? '', input.payoutTerms ?? ''],
        );
      } catch (e) {
        if ((e as { code?: string }).code === '23505')
          throw problem(HttpStatus.CONFLICT, 'supplier-exists', 'A supplier with that name exists');
        throw e;
      }
      await this.audit.record({
        actorType: 'user',
        actorId,
        action: 'partners.supplier_created',
        entityType: 'supplier',
        entityId: id,
        module: 'partners',
        after: input,
      });
    });
    return { id };
  }

  async listPrograms() {
    const rows = await this.db.read<ProgramRow>('partners', `${PROGRAM_SELECT} ORDER BY p.name`);
    return rows.map((r) => this.view(r));
  }

  async getProgram(id: string) {
    const [r] = await this.db.read<ProgramRow>('partners', `${PROGRAM_SELECT} WHERE p.id = $1`, [
      id,
    ]);
    if (!r) throw problem(HttpStatus.NOT_FOUND, 'not-found', 'Program not found');
    return this.view(r);
  }

  private view(r: ProgramRow) {
    return {
      id: r.id,
      supplierId: r.supplier_id,
      supplierName: r.supplier_name,
      name: r.name,
      tier: r.tier,
      description: r.description,
      perks: r.perks,
      rateCodes: r.rate_codes,
      propertyIds: r.property_ids,
      active: r.active,
      effective: r.effective,
      validFrom: r.valid_from,
      validTo: r.valid_to,
      version: r.version,
    };
  }

  async createProgram(actorId: string, input: ProgramInput) {
    const id = newId();
    await this.db.transaction('partners', async (tx) => {
      const [s] = await tx.query('SELECT id FROM partners.suppliers WHERE id = $1', [
        input.supplierId,
      ]);
      if (!s) throw problem(HttpStatus.BAD_REQUEST, 'supplier-invalid', 'Unknown supplier');
      await tx.query(
        `INSERT INTO partners.programs (id, supplier_id, name, tier, description, perks, rate_codes, active, valid_from, valid_to)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          id,
          input.supplierId,
          input.name,
          input.tier,
          input.description ?? '',
          JSON.stringify(input.perks),
          input.rateCodes,
          input.active ?? true,
          input.validFrom ?? null,
          input.validTo ?? null,
        ],
      );
      await this.setProperties(tx, id, input.propertyIds);
      await this.audit.record({
        actorType: 'user',
        actorId,
        action: 'partners.program_created',
        entityType: 'partner_program',
        entityId: id,
        module: 'partners',
        after: input,
      });
      await this.announce(tx, id);
    });
    return this.getProgram(id);
  }

  async updateProgram(
    actorId: string,
    id: string,
    version: number,
    patch: Partial<Omit<ProgramInput, 'supplierId'>>,
  ) {
    await this.db.transaction('partners', async (tx) => {
      const [cur] = await tx.query<{ version: number }>(
        'SELECT version FROM partners.programs WHERE id = $1 FOR UPDATE',
        [id],
      );
      if (!cur) throw problem(HttpStatus.NOT_FOUND, 'not-found', 'Program not found');
      if (cur.version !== version)
        throw problem(
          HttpStatus.CONFLICT,
          'version-conflict',
          'This program was changed by someone else',
        );
      const cols: Record<string, unknown> = {};
      if (patch.name !== undefined) cols.name = patch.name;
      if (patch.tier !== undefined) cols.tier = patch.tier;
      if (patch.description !== undefined) cols.description = patch.description;
      if (patch.perks !== undefined) cols.perks = JSON.stringify(patch.perks);
      if (patch.rateCodes !== undefined) cols.rate_codes = patch.rateCodes;
      if (patch.active !== undefined) cols.active = patch.active;
      if (patch.validFrom !== undefined) cols.valid_from = patch.validFrom;
      if (patch.validTo !== undefined) cols.valid_to = patch.validTo;
      const keys = Object.keys(cols);
      await tx.query(
        `UPDATE partners.programs SET ${[...keys.map((k, i) => `${k} = $${i + 2}`), 'updated_at = now()', 'version = version + 1'].join(', ')} WHERE id = $1`,
        [id, ...keys.map((k) => cols[k])],
      );
      if (patch.propertyIds) await this.setProperties(tx, id, patch.propertyIds);
      await this.audit.record({
        actorType: 'user',
        actorId,
        action: 'partners.program_updated',
        entityType: 'partner_program',
        entityId: id,
        module: 'partners',
        after: patch,
      });
      await this.announce(tx, id);
    });
    return this.getProgram(id);
  }

  private async setProperties(tx: Tx, programId: string, propertyIds: string[]): Promise<void> {
    await tx.query('DELETE FROM partners.program_properties WHERE program_id = $1', [programId]);
    for (const pid of new Set(propertyIds)) {
      await tx.query(
        'INSERT INTO partners.program_properties (program_id, property_id) VALUES ($1, $2)',
        [programId, pid],
      );
    }
  }

  /** Publish the program's current state (Catalog projects it for preferred marking). */
  private async announce(tx: Tx, id: string): Promise<void> {
    const [r] = (await tx.query<ProgramRow>(`${PROGRAM_SELECT} WHERE p.id = $1`, [id])) as [
      ProgramRow,
    ];
    await tx.publish({
      type: 'PartnerProgramChanged',
      version: 1,
      payload: {
        programId: r.id,
        name: r.name,
        tier: r.tier,
        active: r.effective,
        propertyIds: r.property_ids,
        perks: r.perks,
        rateCodes: r.rate_codes,
      },
    });
  }
}
