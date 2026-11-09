import { Module } from '@nestjs/common';

/**
 * Partners module (core domain layer). Preferred partner programs, perks and rate codes (FR-PRT).
 * Owns schema(s): partners.
 * May call (public interfaces only): shared-kernel, identity, notifications, audit.
 */
@Module({
  providers: [],
  exports: [],
})
export class PartnersModule {}
