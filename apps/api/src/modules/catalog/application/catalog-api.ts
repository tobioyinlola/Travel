import { Injectable } from '@nestjs/common';
import { IngestionService } from './ingestion.service.js';
import { SearchService } from './search.service.js';

/** Public interface for higher layers (Itineraries, Booking, Admin, AI). */
@Injectable()
export class CatalogApi {
  constructor(
    private readonly searchService: SearchService,
    private readonly ingestion: IngestionService,
  ) {}

  /** Live re-price of one offer, never cached. Null when sold out. */
  checkRate(rateKey: string, currency: string) {
    return this.searchService.checkRate(rateKey, currency);
  }

  getProperty(id: string) {
    return this.searchService.getProperty(id);
  }

  findProperties(q: string) {
    return this.searchService.findProperties(q);
  }

  ingestAll() {
    return this.ingestion.enqueueAll();
  }
}
