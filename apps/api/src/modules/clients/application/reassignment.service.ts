import { Injectable, OnModuleInit } from '@nestjs/common';
import { EventBus } from '../../../platform/events/event-bus.js';

/**
 * When an advisor's trips move to someone else (they left), the clients on those trips go with them, so the new
 * advisor can see who they are serving (FR-ADM-02). Only the clients on moved trips move; the rest stay put.
 */
@Injectable()
export class ReassignmentService implements OnModuleInit {
  constructor(private readonly bus: EventBus) {}

  onModuleInit(): void {
    this.bus.subscribe<{ fromAdvisorId: string; toAdvisorId: string; clientIds: string[] }>({
      module: 'clients',
      handler: 'clients.followReassignedTrips',
      event: 'TripsReassigned',
      version: 1,
      handle: async (e, tx) => {
        const p = e.payload;
        await tx.setLocal('atp.scope', 'all');
        await tx.query(
          `UPDATE clients.clients SET owner_advisor_id = $2, updated_at = now(), version = version + 1
            WHERE id = ANY($1::uuid[]) AND owner_advisor_id = $3`,
          [p.clientIds, p.toAdvisorId, p.fromAdvisorId],
        );
        for (const table of ['companions', 'trip_history']) {
          await tx.query(
            `UPDATE clients.${table} SET owner_advisor_id = $2 WHERE client_id = ANY($1::uuid[]) AND owner_advisor_id = $3`,
            [p.clientIds, p.toAdvisorId, p.fromAdvisorId],
          );
        }
      },
    });
  }
}
