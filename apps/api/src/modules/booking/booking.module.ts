import { Module } from '@nestjs/common';

/**
 * Booking module (orchestration layer). Booking state machine and supplier reservations (FR-BKG).
 * Owns schema(s): booking.
 * May call (public interfaces only): shared-kernel, identity, notifications, audit, clients, catalog, partners, membership, learning.
 */
@Module({
  providers: [],
  exports: [],
})
export class BookingModule {}
