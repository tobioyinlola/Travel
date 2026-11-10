import { Global, Module } from '@nestjs/common';
import { BookingApi } from './application/booking-api.js';
import { LiveStatusService } from './application/live-status.service.js';
import { BookingService } from './application/booking.service.js';
import { BookingsController, SupportBookingsController } from './http/bookings.controller.js';
import { CheckoutController } from './http/checkout.controller.js';

/**
 * Booking module (orchestration layer). Checkout, the booking state machine and supplier reservations
 * (FR-BKG). Owns schema: booking (row-level security by owning advisor).
 * May call: shared-kernel, identity, catalog. Reaches Payments and Itineraries (same layer) only by events.
 */
@Global() // exports only the public API
@Module({
  controllers: [CheckoutController, BookingsController, SupportBookingsController],
  providers: [BookingService, LiveStatusService, BookingApi],
  exports: [BookingApi],
})
export class BookingModule {}
