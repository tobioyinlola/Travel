import { Module } from '@nestjs/common';

/**
 * Admin module (top layer). Back office: application review, finance tools, config (FR-ADM).
 * Owns schema(s): admin.
 * May call (public interfaces only): shared-kernel, identity, notifications, audit, clients, catalog, partners, membership, learning, itineraries, booking, commission-payments.
 */
@Module({
  providers: [],
  exports: [],
})
export class AdminModule {}
