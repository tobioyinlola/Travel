import { Injectable, OnModuleInit } from '@nestjs/common';
import type { EventPayload } from '@atp/contracts';
import { Database } from '../../../platform/db/database.js';
import { EventBus } from '../../../platform/events/event-bus.js';

/**
 * FR-PRT-02: when a booking is confirmed, record which partner perks apply to each hotel. A program applies
 * when it is in force today, covers the property, and (if it names rate codes) the booked rate carries one.
 */
@Injectable()
export class BookingPerksService implements OnModuleInit {
  constructor(
    private readonly db: Database,
    private readonly bus: EventBus,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe<EventPayload<'BookingConfirmed.v1'>>({
      module: 'partners',
      handler: 'partners.attachPerksOnConfirmation',
      event: 'BookingConfirmed',
      version: 1,
      handle: async (e, tx) => {
        for (const l of e.payload.lines ?? []) {
          if (!l.lineId || !l.propertyId) continue;
          await tx.query(
            `INSERT INTO partners.booking_perks (line_id, program_id, booking_id, advisor_id, program_name, tier, perks)
             SELECT $1, p.id, $2, $3, p.name, p.tier, p.perks
               FROM partners.programs p
               JOIN partners.program_properties pp ON pp.program_id = p.id AND pp.property_id = $4
              WHERE p.active
                AND (p.valid_from IS NULL OR p.valid_from <= current_date)
                AND (p.valid_to IS NULL OR p.valid_to >= current_date)
                AND (cardinality(p.rate_codes) = 0 OR p.rate_codes && $5::text[])
             ON CONFLICT DO NOTHING`,
            [l.lineId, e.payload.bookingId, e.payload.advisorId, l.propertyId, l.rateCodes ?? []],
          );
        }
      },
    });
  }

  async forBooking(advisorId: string, bookingId: string) {
    const rows = await this.db.read<{
      line_id: string;
      program_name: string;
      tier: string;
      perks: Array<{ kind: string; description: string }>;
    }>(
      'partners',
      `SELECT line_id, program_name, tier, perks FROM partners.booking_perks
        WHERE booking_id = $1 AND advisor_id = $2 ORDER BY attached_at`,
      [bookingId, advisorId],
    );
    return {
      items: rows.map((r) => ({
        lineId: r.line_id,
        programName: r.program_name,
        tier: r.tier,
        perks: r.perks,
      })),
    };
  }
}
