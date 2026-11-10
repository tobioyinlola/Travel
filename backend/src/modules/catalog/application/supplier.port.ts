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

export interface ReserveRequest {
  rateKey: string;
  currency: string;
  /** What the traveler was quoted: the supplier must refuse if its price has moved (FR-BKG-01). */
  expectedTotal: Money;
  occupancy: Occupancy;
  guest: { name: string; email: string; phone: string | null; specialRequests: string | null };
  /** The same key always returns the same reservation (no double booking on retry, FR-BKG-06). */
  idempotencyKey: string;
}

export type ReserveResult =
  | {
      status: 'confirmed';
      reservationRef: string;
      confirmationCode: string;
      total: Money;
      /** Provider response kept verbatim for support and reconciliation (FR-BKG-04). */
      raw: unknown;
    }
  | { status: 'rejected'; reason: 'sold_out' | 'price_changed' | 'invalid'; raw: unknown };

export interface CancelResult {
  status: 'cancelled';
  /** What the supplier keeps. Zero inside the free-cancellation window. */
  penalty: Money;
  raw: unknown;
}

export interface AmendResult {
  status: 'amended' | 'rejected';
  raw: unknown;
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
  /**
   * Book one offer. Throws on transport errors or timeouts (the caller retries with the same key);
   * returns `rejected` for definitive refusals (no retry).
   */
  reserve(req: ReserveRequest): Promise<ReserveResult>;
  /** Change the lead guest or requests on a reservation. Throws on transport errors; idempotent by key. */
  amend(
    reservationRef: string,
    guest: ReserveRequest['guest'],
    idempotencyKey: string,
  ): Promise<AmendResult>;
  /** Cancel a reservation. Idempotent by reservation reference. */
  cancel(reservationRef: string, idempotencyKey: string): Promise<CancelResult>;
}

export const HOTEL_SUPPLIERS = Symbol('HotelSuppliers');
