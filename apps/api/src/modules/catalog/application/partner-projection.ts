import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../../platform/events/event-bus.js';

interface ProgramPayload {
  programId: string;
  name: string;
  tier: string;
  active: boolean;
  propertyIds: string[];
  perks: Array<{ kind: string; description: string }>;
  rateCodes: string[];
}

/** Keeps catalog.partner_programs in step with Partners for preferred marking in search (FR-INV-06). */
@Injectable()
export class PartnerProjection implements OnModuleInit {
  constructor(private readonly bus: EventBus) {}

  onModuleInit(): void {
    this.bus.subscribe<ProgramPayload>({
      module: 'catalog',
      handler: 'catalog.projectPartnerProgram',
      event: 'PartnerProgramChanged',
      version: 1,
      handle: async (e, tx) => {
        const p = e.payload;
        // Ignore an older event arriving after a newer one (delivery is not strictly ordered).
        await tx.query(
          `INSERT INTO catalog.partner_programs (program_id, name, tier, active, property_ids, perks, rate_codes, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (program_id) DO UPDATE SET name = EXCLUDED.name, tier = EXCLUDED.tier, active = EXCLUDED.active,
             property_ids = EXCLUDED.property_ids, perks = EXCLUDED.perks, rate_codes = EXCLUDED.rate_codes,
             updated_at = EXCLUDED.updated_at
           WHERE catalog.partner_programs.updated_at <= EXCLUDED.updated_at`,
          [
            p.programId,
            p.name,
            p.tier,
            p.active,
            p.propertyIds,
            JSON.stringify(p.perks),
            p.rateCodes,
            e.occurredAt,
          ],
        );
      },
    });
  }
}
