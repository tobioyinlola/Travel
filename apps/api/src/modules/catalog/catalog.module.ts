import { Module } from '@nestjs/common';

/**
 * Catalog module (core domain layer). Hotel content ingestion, dedupe, search and live rates (FR-INV).
 * Owns schema(s): catalog.
 * May call (public interfaces only): shared-kernel, identity, notifications, audit.
 */
@Module({
  providers: [],
  exports: [],
})
export class CatalogModule {}
