import { Module } from '@nestjs/common';

/**
 * Reporting module (top layer). Dashboards and read models built from events (FR-RPT).
 * Owns schema(s): reporting.
 * May call (public interfaces only): shared-kernel, identity, notifications, audit, clients, catalog, partners, membership, learning, itineraries, booking, commission-payments.
 */
@Module({
  providers: [],
  exports: [],
})
export class ReportingModule {}
