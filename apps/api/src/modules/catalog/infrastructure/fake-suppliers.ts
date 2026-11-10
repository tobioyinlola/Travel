import { createHash } from 'node:crypto';
import type {
  Board,
  CancelResult,
  HotelSupplierPort,
  Occupancy,
  PaymentMode,
  RateQuery,
  ReserveRequest,
  ReserveResult,
  SupplierProperty,
  SupplierRate,
} from '../application/supplier.port.js';
import { addDays, nightsBetween } from '../domain/dates.js';

/**
 * Two fictional wholesalers with overlapping, slightly inconsistent hotel content (names, coordinates), so
 * ingestion has real duplicates to merge. Hotel and brand names are invented. Prices are deterministic for a
 * given hotel, date, occupancy and `priceEpoch`; tests bump the epoch to make quoted rates stale.
 */
interface Destination {
  slug: string;
  city: string;
  country: string;
  lat: number;
  lng: number;
  costFactor: number;
  cityTaxPerAdultNight: number; // USD cents
}

const DESTINATIONS: Destination[] = [
  {
    slug: 'lisbon',
    city: 'Lisbon',
    country: 'PT',
    lat: 38.7223,
    lng: -9.1393,
    costFactor: 1.0,
    cityTaxPerAdultNight: 400,
  },
  {
    slug: 'lagos',
    city: 'Lagos',
    country: 'NG',
    lat: 6.4281,
    lng: 3.4219,
    costFactor: 1.1,
    cityTaxPerAdultNight: 0,
  },
  {
    slug: 'cape-town',
    city: 'Cape Town',
    country: 'ZA',
    lat: -33.9249,
    lng: 18.4241,
    costFactor: 0.9,
    cityTaxPerAdultNight: 0,
  },
  {
    slug: 'zanzibar',
    city: 'Zanzibar',
    country: 'TZ',
    lat: -6.1659,
    lng: 39.2026,
    costFactor: 1.0,
    cityTaxPerAdultNight: 500,
  },
  {
    slug: 'paris',
    city: 'Paris',
    country: 'FR',
    lat: 48.8566,
    lng: 2.3522,
    costFactor: 1.5,
    cityTaxPerAdultNight: 500,
  },
  {
    slug: 'new-york',
    city: 'New York',
    country: 'US',
    lat: 40.7128,
    lng: -74.006,
    costFactor: 1.8,
    cityTaxPerAdultNight: 350,
  },
  {
    slug: 'bali',
    city: 'Seminyak',
    country: 'ID',
    lat: -8.6913,
    lng: 115.1682,
    costFactor: 0.8,
    cityTaxPerAdultNight: 0,
  },
  {
    slug: 'marrakech',
    city: 'Marrakech',
    country: 'MA',
    lat: 31.6295,
    lng: -7.9811,
    costFactor: 0.85,
    cityTaxPerAdultNight: 300,
  },
];

const BRANDS = [
  'Azure Collection',
  'Harbourline',
  'Casa Verde',
  'Northlight',
  'Palm & Pine',
  'Old Quarter',
];
const SUFFIX = ['Hotel', 'Suites', 'House', 'Resort & Spa', 'Residences', 'Inn'];
const AMENITIES = [
  'wifi',
  'pool',
  'spa',
  'gym',
  'restaurant',
  'bar',
  'beach',
  'kids_club',
  'airport_shuttle',
  'parking',
  'accessible_rooms',
  'pet_friendly',
];
const ROOMS = [
  { code: 'STD', name: 'Standard double', maxOccupancy: 2, factor: 1.0 },
  { code: 'DLX', name: 'Deluxe king', maxOccupancy: 3, factor: 1.35 },
  { code: 'FAM', name: 'Family suite', maxOccupancy: 5, factor: 1.9 },
];
/** Fixed demo FX from USD (multi-currency proper is NFR-14, V1). */
const FX: Record<string, number> = { USD: 1, EUR: 0.92, GBP: 0.79, NGN: 1550, ZAR: 18.4 };

function hash(...parts: Array<string | number>): number {
  return createHash('sha1').update(parts.join('|')).digest().readUInt32BE(0);
}

interface Hotel {
  index: number;
  dest: Destination;
  name: string;
  brand: string;
  stars: number;
  lat: number;
  lng: number;
  amenities: string[];
  sharedId: string | null;
}

const HOTELS: Hotel[] = DESTINATIONS.flatMap((dest) =>
  Array.from({ length: 6 }, (_, i) => {
    const h = hash(dest.slug, i);
    const brand = BRANDS[(i + dest.slug.length) % BRANDS.length]!;
    return {
      index: i,
      dest,
      brand,
      name: `${brand} ${dest.city} ${SUFFIX[i]!}`,
      stars: 3 + (h % 3),
      lat: dest.lat + (((h >> 4) % 400) - 200) / 10000,
      lng: dest.lng + (((h >> 12) % 400) - 200) / 10000,
      amenities: AMENITIES.filter((_, k) => (h >> k) & 1 || k === 0),
      sharedId: i % 2 === 0 ? `GID-${dest.slug}-${i}` : null,
    };
  }),
);

export interface FakeSupplierOptions {
  latencyMs?: number;
}

export class FakeHotelSupplier implements HotelSupplierPort {
  priceEpoch = 0;
  /** Test hooks: make calls fail or hang. */
  failing = false;
  hangMs = 0;
  readonly soldOut = new Set<string>();
  /** Test hooks for booking: transport errors for the next N reserve calls, or a definitive refusal. */
  reserveFailures = 0;
  rejectReserve: 'sold_out' | 'price_changed' | 'invalid' | null = null;
  /** Refuse only some requests (e.g. the second hotel of a booking). */
  rejectWhen: ((req: ReserveRequest) => 'sold_out' | 'price_changed' | 'invalid' | null) | null =
    null;
  /** Every reserve call that reached this supplier, for assertions (idempotency, retries). */
  readonly reserveCalls: ReserveRequest[] = [];

  constructor(
    readonly name: 'fake-wholesaler-a' | 'fake-wholesaler-b',
    private readonly opts: FakeSupplierOptions = {},
  ) {}

  private covers(h: Hotel): boolean {
    return this.name === 'fake-wholesaler-a' ? h.index <= 4 : h.index >= 2;
  }

  private id(h: Hotel): string {
    return `${this.name === 'fake-wholesaler-a' ? 'A' : 'B'}-${h.dest.slug}-${h.index}`;
  }

  private find(supplierPropertyId: string): Hotel | undefined {
    return HOTELS.find((h) => this.covers(h) && this.id(h) === supplierPropertyId);
  }

  private async delay(): Promise<void> {
    const ms = this.hangMs || this.opts.latencyMs || 0;
    if (ms) await new Promise((r) => setTimeout(r, ms));
    if (this.failing) throw new Error(`${this.name} unavailable`);
  }

  private toContent(h: Hotel): SupplierProperty {
    const b = this.name === 'fake-wholesaler-b';
    return {
      supplierPropertyId: this.id(h),
      // Supplier B formats names differently and is a few tens of metres off: real-world mess.
      name: b ? `The ${h.name.replace('&', 'and')}` : h.name,
      sharedId: h.sharedId,
      brand: h.brand,
      starRating: h.stars,
      address: `${10 + h.index * 7} Example Street, ${h.dest.city}`,
      city: h.dest.city,
      countryCode: h.dest.country,
      lat: b ? h.lat + 0.0003 : h.lat,
      lng: b ? h.lng - 0.0002 : h.lng,
      amenities: h.amenities,
      description: `A ${h.stars}-star ${SUFFIX[h.index]!.toLowerCase()} in ${h.dest.city}. Demo content from a test supplier.`,
      photos: [`https://picsum.photos/seed/${this.id(h)}/800/600`],
    };
  }

  async listContent(cursor: string | null) {
    await this.delay();
    const all = HOTELS.filter((h) => this.covers(h));
    const start = cursor ? Number(cursor) : 0;
    const items = all.slice(start, start + 20).map((h) => this.toContent(h));
    return { items, nextCursor: start + 20 < all.length ? String(start + 20) : null };
  }

  async searchRates(q: RateQuery): Promise<SupplierRate[]> {
    await this.delay();
    return q.supplierPropertyIds.flatMap((id) => {
      const h = this.find(id);
      if (!h) return [];
      return ROOMS.flatMap((room) =>
        (['room_only', 'breakfast'] as Board[]).flatMap((board) =>
          [true, false].map((refundable) =>
            this.price(
              h,
              room.code,
              board,
              refundable,
              q.checkIn,
              q.checkOut,
              q.occupancy,
              q.currency,
            ),
          ),
        ),
      ).filter((r): r is SupplierRate => r !== null);
    });
  }

  async checkRate(rateKey: string, currency: string): Promise<SupplierRate | null> {
    await this.delay();
    const k = decodeKey(rateKey);
    if (k.s !== this.name) return null;
    const h = this.find(k.h);
    if (!h) return null;
    return this.price(h, k.r, k.b, k.rf, k.ci, k.co, { adults: k.a, childrenAges: k.c }, currency);
  }

  /**
   * Stateless on purpose (API and worker are separate processes): the reservation reference encodes the
   * offer, so the same idempotency key always yields the same reference and cancel can re-derive terms.
   */
  async reserve(req: ReserveRequest): Promise<ReserveResult> {
    await this.delay();
    this.reserveCalls.push(req);
    if (this.reserveFailures > 0) {
      this.reserveFailures -= 1;
      throw new Error(`${this.name} reserve timed out`);
    }
    const refusal = this.rejectReserve ?? this.rejectWhen?.(req) ?? null;
    if (refusal) return { status: 'rejected', reason: refusal, raw: { error: refusal } };
    const rate = await this.checkRate(req.rateKey, req.currency);
    if (!rate) return { status: 'rejected', reason: 'sold_out', raw: { error: 'sold_out' } };
    if (rate.total.amountMinor !== req.expectedTotal.amountMinor) {
      return {
        status: 'rejected',
        reason: 'price_changed',
        raw: { error: 'price_changed', now: rate.total },
      };
    }
    const reservationRef = `RSV-${Buffer.from(
      JSON.stringify({
        k: req.rateKey,
        i: req.idempotencyKey,
        c: req.currency,
        t: rate.total.amountMinor,
      }),
    ).toString('base64url')}`;
    const confirmationCode = hash(this.name, req.idempotencyKey)
      .toString(36)
      .toUpperCase()
      .padStart(7, '0');
    return {
      status: 'confirmed',
      reservationRef,
      confirmationCode,
      total: rate.total,
      raw: { supplier: this.name, reservationRef, confirmationCode, guest: req.guest.name },
    };
  }

  async cancel(reservationRef: string): Promise<CancelResult> {
    await this.delay();
    const decoded = JSON.parse(
      Buffer.from(reservationRef.replace(/^RSV-/, ''), 'base64url').toString('utf8'),
    ) as { k: string; c: string; t: string };
    const k = decodeKey(decoded.k);
    const total = Number(decoded.t);
    const nights = nightsBetween(k.ci, k.co);
    const freeUntil = new Date(`${addDays(k.ci, -3)}T12:00:00Z`);
    const inWindow = k.rf && new Date() <= freeUntil;
    // Refundable after the window: first night. Non-refundable: everything.
    const penalty = inWindow ? 0 : k.rf ? Math.round(total / nights) : total;
    return {
      status: 'cancelled',
      penalty: { amountMinor: String(penalty), currency: decoded.c },
      raw: { supplier: this.name, reservationRef, penalty },
    };
  }

  private price(
    h: Hotel,
    roomCode: string,
    board: Board,
    refundable: boolean,
    checkIn: string,
    checkOut: string,
    occ: Occupancy,
    currency: string,
  ): SupplierRate | null {
    const room = ROOMS.find((r) => r.code === roomCode);
    if (!room) return null;
    const guests = occ.adults + occ.childrenAges.length;
    if (guests > room.maxOccupancy || occ.adults < 1) return null;
    const fx = FX[currency];
    if (!fx) return null;
    const nights = nightsBetween(checkIn, checkOut);
    if (nights < 1 || nights > 30) return null;
    let roomCents = 0;
    for (let n = 0; n < nights; n++) {
      const day = addDays(checkIn, n);
      if (this.soldOut.has(`${this.id(h)}:${day}`) || hash(this.id(h), room.code, day) % 23 === 0)
        return null;
      const weekend = [5, 6].includes(new Date(`${day}T00:00:00Z`).getUTCDay()) ? 1.15 : 1;
      const base =
        (h.stars * 5000 + (hash(this.id(h)) % 3000)) * h.dest.costFactor * room.factor * weekend;
      roomCents += Math.round(
        base * (this.name === 'fake-wholesaler-b' ? 0.97 : 1) * Math.pow(1.05, this.priceEpoch),
      );
    }
    if (board === 'breakfast') roomCents += 1800 * occ.adults * nights;
    if (!refundable) roomCents = Math.round(roomCents * 0.9);
    const taxesCents = Math.round(roomCents * 0.12);
    const feesCents = h.dest.cityTaxPerAdultNight * occ.adults * nights;
    const conv = (usdCents: number) => String(Math.round(usdCents * fx));
    const freeUntil = refundable ? `${addDays(checkIn, -3)}T12:00:00Z` : null;
    const paymentModes: PaymentMode[] = refundable ? ['pay_at_hotel', 'prepay'] : ['prepay'];
    if (h.stars === 5) paymentModes.push('deposit');
    return {
      rateKey: encodeKey({
        s: this.name,
        h: this.id(h),
        r: room.code,
        b: board,
        rf: refundable,
        ci: checkIn,
        co: checkOut,
        a: occ.adults,
        c: occ.childrenAges,
      }),
      supplierPropertyId: this.id(h),
      checkIn,
      checkOut,
      occupancy: occ,
      roomName: room.name,
      maxOccupancy: room.maxOccupancy,
      board,
      refundable,
      freeCancellationUntil: freeUntil,
      cancellationPolicy: refundable
        ? `Free cancellation until 3 days before arrival (${freeUntil!.slice(0, 10)} 12:00 UTC). After that, the first night is charged.`
        : 'Non-refundable: the full amount is charged if you cancel or do not arrive.',
      total: { amountMinor: conv(roomCents + taxesCents), currency },
      taxes: { amountMinor: conv(taxesCents), currency },
      feesAtHotel: { amountMinor: conv(feesCents), currency },
      commissionable: { amountMinor: conv(roomCents), currency },
      commissionBps: (refundable ? 1200 : 1000) - (this.name === 'fake-wholesaler-b' ? 200 : 0),
      paymentModes,
      rateCodes: refundable && board === 'breakfast' ? ['ADV'] : ['BAR'],
    };
  }
}

interface KeyData {
  s: string;
  h: string;
  r: string;
  b: Board;
  rf: boolean;
  ci: string;
  co: string;
  a: number;
  c: number[];
}

function encodeKey(k: KeyData): string {
  return Buffer.from(JSON.stringify(k)).toString('base64url');
}

function decodeKey(key: string): KeyData {
  return JSON.parse(Buffer.from(key, 'base64url').toString('utf8')) as KeyData;
}

export const FAKE_DESTINATIONS = DESTINATIONS.map((d) => ({
  slug: d.slug,
  name: d.city,
  countryCode: d.country,
  lat: d.lat,
  lng: d.lng,
}));
