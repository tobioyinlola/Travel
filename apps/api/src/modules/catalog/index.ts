// Public interface of the catalog module. Other modules may import ONLY from this file.
export { CatalogModule } from './catalog.module.js';
export { CatalogApi } from './application/catalog-api.js';
export type { RateView, PropertySummary, Preferred, Perk } from './application/search.service.js';
export { HOTEL_SUPPLIERS } from './application/supplier.port.js';
export { FakeHotelSupplier } from './infrastructure/fake-suppliers.js';
export { rateSchema, propertySchema, preferredSchema } from './http/schemas.js';
export { nightsBetween, addDays } from './domain/dates.js';
