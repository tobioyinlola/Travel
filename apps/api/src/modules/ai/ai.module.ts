import { Module } from '@nestjs/common';

/**
 * Ai module (top layer). AI assistant: retrieval Q&A, drafts that need advisor approval (FR-AI).
 * Owns schema(s): ai.
 * May call (public interfaces only): shared-kernel, identity, notifications, audit, clients, catalog, partners, membership, learning, itineraries, booking, commission-payments.
 */
@Module({
  providers: [],
  exports: [],
})
export class AiModule {}
