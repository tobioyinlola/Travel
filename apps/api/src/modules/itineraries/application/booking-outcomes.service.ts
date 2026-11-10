import { Injectable, OnModuleInit } from '@nestjs/common';
import { Database } from '../../../platform/db/database.js';
import type { Tx } from '../../../platform/db/tx.js';
import { EventBus } from '../../../platform/events/event-bus.js';

/**
 * Keeps a trip's status in step with its booking. Booking is in the same layer, so the two talk by events:
 * confirmed -> booked, cancelled -> cancelled, and a failed or discarded booking reopens the trip for changes
 * (the approved proposal is superseded; the advisor publishes a new version on the same link).
 */
@Injectable()
export class BookingOutcomes implements OnModuleInit {
  constructor(
    private readonly db: Database,
    private readonly bus: EventBus,
  ) {}

  onModuleInit(): void {
    this.moveTrips();
    this.on('BookingConfirmed', 'itineraries.tripBooked', (tx, p) =>
      this.setStatus(tx, p.tripId, 'booked', ['approved']),
    );
    this.on('BookingCancelled', 'itineraries.tripCancelled', (tx, p) =>
      this.setStatus(tx, p.tripId, 'cancelled', ['booked']),
    );
    this.on('BookingFailed', 'itineraries.tripReopenedAfterFailure', (tx, p) =>
      this.reopen(tx, p.tripId),
    );
    this.on('BookingDiscarded', 'itineraries.tripReopenedAfterDiscard', (tx, p) =>
      this.reopen(tx, p.tripId),
    );
  }

  private moveTrips(): void {
    this.bus.subscribe<{
      fromAdvisorId: string;
      toAdvisorId: string;
      toAdvisorUserId: string;
      tripIds: string[];
    }>({
      module: 'itineraries',
      handler: 'itineraries.tripsFollowBookings',
      event: 'AdvisorBookingsReassigned',
      version: 1,
      handle: async (e, tx) => {
        const p = e.payload;
        await tx.setLocal('atp.scope', 'all');
        const trips = await tx.query<{ id: string; client_id: string }>(
          `UPDATE itineraries.trips SET owner_advisor_id = $2, updated_at = now(), version = version + 1
            WHERE id = ANY($1::uuid[]) AND owner_advisor_id = $3 RETURNING id, client_id`,
          [p.tripIds, p.toAdvisorId, p.fromAdvisorId],
        );
        if (trips.length === 0) return;
        const ids = trips.map((t) => t.id);
        await tx.query(
          `UPDATE itineraries.items SET owner_advisor_id = $2 WHERE trip_id = ANY($1::uuid[])`,
          [ids, p.toAdvisorId],
        );
        await tx.query(
          `UPDATE itineraries.proposals SET owner_advisor_id = $2, advisor_user_id = $3 WHERE trip_id = ANY($1::uuid[])`,
          [ids, p.toAdvisorId, p.toAdvisorUserId],
        );
        await tx.publish({
          type: 'TripsReassigned',
          version: 1,
          payload: {
            fromAdvisorId: p.fromAdvisorId,
            toAdvisorId: p.toAdvisorId,
            tripIds: ids,
            clientIds: [...new Set(trips.map((t) => t.client_id))],
          },
        });
      },
    });
  }

  private on(
    event: string,
    handler: string,
    fn: (tx: Tx, payload: { tripId?: string }) => Promise<void>,
  ): void {
    this.bus.subscribe<{ tripId?: string }>({
      module: 'itineraries',
      handler,
      event,
      version: 1,
      handle: async (e, tx) => {
        if (!e.payload.tripId) return;
        await tx.setLocal('atp.scope', 'all');
        await fn(tx, e.payload);
      },
    });
  }

  private async reopen(tx: Tx, tripId: string | undefined): Promise<void> {
    if (!tripId) return;
    await this.setStatus(tx, tripId, 'planning', ['approved']);
    await tx.query(
      `UPDATE itineraries.proposals SET status = 'superseded' WHERE trip_id = $1 AND status = 'approved'`,
      [tripId],
    );
  }

  private async setStatus(
    tx: Tx,
    tripId: string | undefined,
    to: 'planning' | 'booked' | 'cancelled',
    from: string[],
  ): Promise<void> {
    if (!tripId) return;
    const [t] = await tx.query<{
      client_id: string;
      owner_advisor_id: string;
      title: string;
      start_date: string;
      end_date: string;
    }>(
      `UPDATE itineraries.trips SET status = $2, updated_at = now(), version = version + 1
        WHERE id = $1 AND status = ANY($3)
        RETURNING client_id, owner_advisor_id, title, to_char(start_date, 'YYYY-MM-DD') AS start_date,
                  to_char(end_date, 'YYYY-MM-DD') AS end_date`,
      [tripId, to, from],
    );
    if (!t) return; // already in that state, or not in a state this event applies to
    await tx.publish({
      type: 'TripUpdated',
      version: 1,
      payload: {
        tripId,
        clientId: t.client_id,
        advisorId: t.owner_advisor_id,
        title: t.title,
        startDate: t.start_date,
        endDate: t.end_date,
        status: to,
      },
    });
  }
}
