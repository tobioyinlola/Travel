import { Injectable } from '@nestjs/common';
import { IngestionService } from './ingestion.service.js';
import { SearchService } from './search.service.js';
import type { ReserveRequest } from './supplier.port.js';

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

  /** Book one offer with its supplier. Throws on transport errors (retry with the same key). */
  reserve(rateKey: string, req: Omit<ReserveRequest, 'rateKey'>) {
    return this.searchService.reserve(rateKey, req);
  }

  amendReservation(qualifiedRef: string, guest: ReserveRequest['guest'], idempotencyKey: string) {
    return this.searchService.amendReservation(qualifiedRef, guest, idempotencyKey);
  }

  cancelReservation(qualifiedRef: string, idempotencyKey: string) {
    return this.searchService.cancelReservation(qualifiedRef, idempotencyKey);
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
