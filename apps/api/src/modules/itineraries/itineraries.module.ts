import { Module } from '@nestjs/common';
import { BookingOutcomes } from './application/booking-outcomes.service.js';
import { ProposalLinkService } from './application/proposal-link.service.js';
import { TripsService } from './application/trips.service.js';
import { ProposalLinkController } from './http/proposal-link.controller.js';
import { TripsController } from './http/trips.controller.js';

/**
 * Itineraries module (orchestration layer). Trips, itinerary builder, proposals and the traveler link
 * (FR-ITN, FR-TRV). Owns schema: itineraries (row-level security by owning advisor).
 * May call: shared-kernel, identity, clients, catalog, partners.
 */
@Module({
  controllers: [TripsController, ProposalLinkController],
  providers: [TripsService, ProposalLinkService, BookingOutcomes],
})
export class ItinerariesModule {}
