import { Global, Module } from '@nestjs/common';
import { PartnersApi } from './application/partners-api.js';
import { BookingPerksService } from './application/booking-perks.service.js';
import { BookingPerksController } from './http/booking-perks.controller.js';
import { PartnersService } from './application/partners.service.js';

/**
 * Partners module (core domain layer). Preferred partner programs, perks and rate codes (FR-PRT).
 * Owns schema: partners. May call: shared-kernel, identity. Managed through the admin console.
 */
@Global() // exports only the public API
@Module({
  controllers: [BookingPerksController],
  providers: [PartnersService, PartnersApi, BookingPerksService],
  exports: [PartnersApi],
})
export class PartnersModule {}
