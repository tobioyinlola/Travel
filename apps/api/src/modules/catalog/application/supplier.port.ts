/**
 * ARCH HotelSupplierPort: one adapter per wholesaler/aggregator (or direct connection). Adapters translate
 * the provider's model into these types; nothing provider-specific leaks past this file.
 */
export interface Money {
  amountMinor: string;
  currency: string;
}

export interface SupplierProperty {
  supplierPropertyId: string;
  name: string;
  /** Shared industry identifier when the supplier provides one (used first when de-duplicating). */
  sharedId: string | null;
  brand: string | null;
  starRating: number;
  address: string;
  city: string;
  countryCode: string;
  lat: number;
  lng: number;
  amenities: string[];
  description: string;
  photos: string[];
}

export interface Occupancy {
  adults: number;
  childrenAges: number[];
}

export type Board = 'room_only' | 'breakfast' | 'half_board' | 'all_inclusive';
export type PaymentMode = 'pay_at_hotel' | 'prepay' | 'deposit';

export interface SupplierRate {
  /** Opaque, supplier-scoped. Enough for the supplier to re-price and later reserve this exact offer. */
  rateKey: string;
  supplierPropertyId: string;
  checkIn: string;
  checkOut: string;
  occupancy: Occupancy;
  roomName: string;
  maxOccupancy: number;
  board: Board;
  refundable: boolean;
  /** Free cancellation until this instant (UTC), if refundable. */
  freeCancellationUntil: string | null;
  cancellationPolicy: string;
  /** Everything charged at booking, taxes included, all nights. */
  total: Money;
  taxes: Money;
  /** Charged by the hotel at the property (city tax, resort fees), not included in `total`. */
  feesAtHotel: Money;
  commissionable: Money;
  commissionBps: number;
  paymentModes: PaymentMode[];
  rateCodes: string[];
}

export interface RateQuery {
  supplierPropertyIds: string[];
  checkIn: string;
  checkOut: string;
  occupancy: Occupancy;
  currency: string;
}

export interface HotelSupplierPort {
  readonly name: string;
  /** Content for ingestion, paged. */
  listContent(
    cursor: string | null,
  ): Promise<{ items: SupplierProperty[]; nextCursor: string | null }>;
  searchRates(q: RateQuery): Promise<SupplierRate[]>;
  /** Re-price one offer now; null when no longer available. Never cached (ARCH). */
  checkRate(rateKey: string, currency: string): Promise<SupplierRate | null>;
}

export const HOTEL_SUPPLIERS = Symbol('HotelSuppliers');
