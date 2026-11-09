import { Module } from '@nestjs/common';

/**
 * Clients module (core domain layer). Client CRM: profiles, preferences, trip history, privacy requests (FR-CRM).
 * Owns schema(s): clients.
 * May call (public interfaces only): shared-kernel, identity, notifications, audit.
 */
@Module({
  providers: [],
  exports: [],
})
export class ClientsModule {}
