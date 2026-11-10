import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../../platform/events/event-bus.js';

/**
 * FR-CRM-08: when a client's data is erased, this module removes what it holds about them: the message thread
 * with its files, and the personal names stored inside proposal snapshots. Trips, prices and bookings stay
 * (financial records), without the person's name.
 */
@Injectable()
export class ErasureService implements OnModuleInit {
  constructor(private readonly bus: EventBus) {}

  onModuleInit(): void {
    this.bus.subscribe<{ clientId: string; advisorId: string }>({
      module: 'itineraries',
      handler: 'itineraries.eraseClient',
      event: 'ClientDataErased',
      version: 1,
      handle: async (e, tx) => {
        await tx.setLocal('atp.scope', 'all');
        const trips = (
          await tx.query<{ id: string }>(`SELECT id FROM itineraries.trips WHERE client_id = $1`, [
            e.payload.clientId,
          ])
        ).map((t) => t.id);
        if (trips.length === 0) return;
        await tx.query(`DELETE FROM itineraries.attachments WHERE trip_id = ANY($1::uuid[])`, [
          trips,
        ]);
        await tx.query(`DELETE FROM itineraries.messages WHERE trip_id = ANY($1::uuid[])`, [trips]);
        await tx.query(
          `UPDATE itineraries.proposals
              SET snapshot = jsonb_set(snapshot, '{clientFirstName}', '"Client"'),
                  decided_by_name = CASE WHEN decided_by_name IS NULL THEN NULL ELSE 'Erased' END,
                  decision_note = CASE WHEN decision_note IS NULL THEN NULL ELSE '' END
            WHERE trip_id = ANY($1::uuid[])`,
          [trips],
        );
        await tx.query(`UPDATE itineraries.trips SET notes = '' WHERE id = ANY($1::uuid[])`, [
          trips,
        ]);
      },
    });
  }
}
