import { Global, Module } from '@nestjs/common';
import { ClientsApi } from './application/clients-api.js';
import { ClientsService } from './application/clients.service.js';
import { ClientsController } from './http/clients.controller.js';

/**
 * Clients module (core domain layer). Client CRM: profiles, preferences, trip history, privacy requests
 * (FR-CRM). Owns schema: clients (row-level security by owning advisor). May call: shared-kernel, identity.
 */
@Global() // exports only the public API
@Module({
  controllers: [ClientsController],
  providers: [ClientsService, ClientsApi],
  exports: [ClientsApi],
})
export class ClientsModule {}
