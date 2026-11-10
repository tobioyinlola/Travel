import { Global, Module } from '@nestjs/common';
import { CatalogApi } from './application/catalog-api.js';
import { IngestionService } from './application/ingestion.service.js';
import { PartnerProjection } from './application/partner-projection.js';
import { SearchService } from './application/search.service.js';
import { HOTEL_SUPPLIERS } from './application/supplier.port.js';
import { CatalogController } from './http/catalog.controller.js';
import { FakeHotelSupplier } from './infrastructure/fake-suppliers.js';

/**
 * Catalog module (core domain layer). Hotel content ingestion, de-duplication, search and live rates
 * (FR-INV). Owns schema: catalog. May call: shared-kernel, identity.
 * Suppliers: two fake wholesalers until the inventory source is chosen (decision D2).
 */
@Global() // exports only the public API
@Module({
  controllers: [CatalogController],
  providers: [
    SearchService,
    IngestionService,
    PartnerProjection,
    CatalogApi,
    {
      provide: HOTEL_SUPPLIERS,
      useValue: [
        new FakeHotelSupplier('fake-wholesaler-a'),
        new FakeHotelSupplier('fake-wholesaler-b'),
      ],
    },
  ],
  exports: [CatalogApi, HOTEL_SUPPLIERS],
})
export class CatalogModule {}
