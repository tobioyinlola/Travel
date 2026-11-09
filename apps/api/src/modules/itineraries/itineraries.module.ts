import { Module } from '@nestjs/common';

/**
 * Itineraries module (orchestration layer). Itinerary builder, proposals, secure traveler links (FR-ITN, FR-TRV).
 * Owns schema(s): itineraries.
 * May call (public interfaces only): shared-kernel, identity, notifications, audit, clients, catalog, partners, membership, learning.
 */
@Module({
  providers: [],
  exports: [],
})
export class ItinerariesModule {}
