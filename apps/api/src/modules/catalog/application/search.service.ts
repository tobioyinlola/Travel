import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { Redis } from 'ioredis';
import { Database } from '../../../platform/db/database.js';
import { ProblemException, problemType } from '../../../platform/http/problem.js';
import { CircuitBreaker, withTimeout } from '../../../platform/resilience/resilience.js';
import { REDIS } from '../../../platform/tokens.js';
import { addDays, nightsBetween } from '../domain/dates.js';
import {
  HOTEL_SUPPLIERS,
  type HotelSupplierPort,
  type Money,
  type Occupancy,
  type SupplierRate,
} from './supplier.port.js';

const SUPPLIER_TIMEOUT_MS = 2500;
const RATE_CACHE_SECONDS = 120;
const MAX_CANDIDATES = 100;
const RATES_PER_PROPERTY = 6;

const problem = (status: HttpStatus, slug: string, title: string, detail?: string) =>
  new ProblemException(status, problemType(slug), title, detail);

export interface SearchInput {
  destination: string;
  checkIn: string;
  checkOut: string;
  adults: number;
  childrenAges: number[];
  currency: string;
  maxNightly?: string | undefined; // minor units
  minStars?: number | undefined;
  brand?: string | undefined;
  amenities?: string[] | undefined;
  preferredOnly?: boolean | undefined;
  sort: 'recommended' | 'price' | 'stars';
  limit: number;
}

export interface Perk {
  kind: string;
  description: string;
}

export interface Preferred {
  programId: string;
  programName: string;
  tier: string;
  perks: Perk[];
  rateCodes: string[];
}

/** A priced offer as the platform presents it. `rateKey` is opaque and supplier-qualified. */
export interface RateView extends Omit<SupplierRate, 'rateKey' | 'supplierPropertyId'> {
  rateKey: string;
  supplier: string;
  propertyId: string;
  nights: number;
  nightlyAverage: Money;
  /** Perks of the property's partner program apply to this rate (rate code eligible). */
  partnerEligible: boolean;
  checkedAt: string;
}

export interface PropertySummary {
  id: string;
  name: string;
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

export interface SearchResult {
  property: PropertySummary;
  preferred: Preferred | null;
  fromNightly: Money;
  rates: RateView[];
}

interface CandidateRow {
  id: string;
  name: string;
  brand: string | null;
  star_rating: string;
  address: string;
  city: string;
  country_code: string;
  lat: number;
  lng: number;
  amenities: string[];
  description: string;
  photos: string[];
  sources: Array<{ supplier: string; id: string }>;
}

export function qualifyKey(supplier: string, key: string): string {
  return `${supplier}~${key}`;
}

function splitKey(rateKey: string): { supplier: string; key: string } {
  const i = rateKey.indexOf('~');
  if (i < 1) throw problem(HttpStatus.BAD_REQUEST, 'rate-key-invalid', 'Unknown rate');
  return { supplier: rateKey.slice(0, i), key: rateKey.slice(i + 1) };
}

/** FR-INV-04/05/06: destination search with live rates from every supplier, degrading per supplier. */
@Injectable()
export class SearchService {
  private readonly logger = new Logger('CatalogSearch');
  private readonly breakers = new Map<string, CircuitBreaker>();

  constructor(
    private readonly db: Database,
    @Inject(HOTEL_SUPPLIERS) private readonly suppliers: HotelSupplierPort[],
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  private breaker(name: string): CircuitBreaker {
    let b = this.breakers.get(name);
    if (!b) this.breakers.set(name, (b = new CircuitBreaker(name)));
    return b;
  }

  /** Each supplier call: circuit breaker + explicit timeout (bulkheaded: one supplier cannot stall another). */
  private call<T>(supplier: string, label: string, fn: () => Promise<T>): Promise<T> {
    return this.breaker(supplier).run(() =>
      withTimeout(fn(), SUPPLIER_TIMEOUT_MS, `${supplier} ${label}`),
    );
  }

  /** Test and ops hook: close every circuit (e.g. after a supplier incident is resolved). */
  resetBreakers(): void {
    this.breakers.clear();
  }

  async destinations(q?: string) {
    return this.db.read<{ slug: string; name: string; countryCode: string }>(
      'catalog',
      `SELECT slug, name, country_code AS "countryCode" FROM catalog.destinations
        WHERE $1::text IS NULL OR name ILIKE '%' || $1 || '%' OR slug ILIKE '%' || $1 || '%' ORDER BY name`,
      [q ?? null],
    );
  }

  private validateDates(checkIn: string, checkOut: string): number {
    const today = new Date().toISOString().slice(0, 10);
    if (checkIn < today)
      throw problem(HttpStatus.BAD_REQUEST, 'dates-invalid', 'Check-in is in the past');
    const nights = nightsBetween(checkIn, checkOut);
    if (nights < 1 || nights > 30)
      throw problem(HttpStatus.BAD_REQUEST, 'dates-invalid', 'Stays are 1 to 30 nights');
    if (checkIn > addDays(today, 500))
      throw problem(HttpStatus.BAD_REQUEST, 'dates-invalid', 'Check-in is too far ahead');
    return nights;
  }

  async search(input: SearchInput) {
    const started = Date.now();
    const nights = this.validateDates(input.checkIn, input.checkOut);
    const [dest] = await this.db.read<{
      slug: string;
      name: string;
      lat: number;
      lng: number;
      radius_km: number;
    }>(
      'catalog',
      'SELECT slug, name, lat, lng, radius_km FROM catalog.destinations WHERE slug = $1',
      [input.destination],
    );
    if (!dest) throw problem(HttpStatus.BAD_REQUEST, 'destination-invalid', 'Unknown destination');

    const dLat = dest.radius_km / 111;
    const dLng = dest.radius_km / (111 * Math.max(0.1, Math.cos((dest.lat * Math.PI) / 180)));
    const params: unknown[] = [
      dest.lat - dLat,
      dest.lat + dLat,
      dest.lng - dLng,
      dest.lng + dLng,
      dest.lat,
      dest.lng,
      dest.radius_km * 1000,
      MAX_CANDIDATES,
    ];
    const where: string[] = [];
    if (input.minStars) where.push(`p.star_rating >= $${params.push(input.minStars)}`);
    if (input.brand) where.push(`p.brand ILIKE $${params.push(input.brand)}`);
    if (input.amenities?.length)
      where.push(`p.amenities @> $${params.push(input.amenities)}::text[]`);
    const candidates = await this.db.read<CandidateRow>(
      'catalog',
      `SELECT p.*, (SELECT json_agg(json_build_object('supplier', s.supplier, 'id', s.supplier_property_id))
                      FROM catalog.property_sources s WHERE s.property_id = p.id) AS sources
         FROM catalog.properties p
        WHERE p.lat BETWEEN $1 AND $2 AND p.lng BETWEEN $3 AND $4
          AND 2 * 6371000 * asin(sqrt(power(sin(radians(p.lat - $5) / 2), 2)
              + cos(radians($5)) * cos(radians(p.lat)) * power(sin(radians(p.lng - $6) / 2), 2))) <= $7
          ${where.map((w) => `AND ${w}`).join(' ')}
        LIMIT $8`,
      params,
    );

    const occupancy: Occupancy = { adults: input.adults, childrenAges: input.childrenAges };
    const bySupplier = new Map<string, Array<{ propertyId: string; supplierPropertyId: string }>>();
    for (const c of candidates) {
      for (const s of c.sources ?? []) {
        if (!bySupplier.has(s.supplier)) bySupplier.set(s.supplier, []);
        bySupplier.get(s.supplier)!.push({ propertyId: c.id, supplierPropertyId: s.id });
      }
    }

    const warnings: Array<{ supplier: string; reason: string }> = [];
    const ratesByProperty = new Map<string, RateView[]>();
    await Promise.all(
      [...bySupplier.entries()].map(async ([supplierName, refs]) => {
        const supplier = this.suppliers.find((s) => s.name === supplierName);
        if (!supplier) return;
        try {
          const { rates, checkedAt } = await this.cachedRates(
            supplier,
            refs.map((r) => r.supplierPropertyId),
            input,
            occupancy,
          );
          for (const r of rates) {
            const ref = refs.find((x) => x.supplierPropertyId === r.supplierPropertyId);
            if (!ref) continue;
            const view = this.toView(supplierName, ref.propertyId, r, checkedAt);
            if (!ratesByProperty.has(ref.propertyId)) ratesByProperty.set(ref.propertyId, []);
            ratesByProperty.get(ref.propertyId)!.push(view);
          }
        } catch (e) {
          // Degraded mode (ARCH): show what other suppliers returned and say which one is missing.
          this.logger.warn(`${supplierName} search failed: ${(e as Error).message}`);
          warnings.push({
            supplier: supplierName,
            reason:
              (e as Error).name === 'CircuitOpenError'
                ? 'temporarily_unavailable'
                : 'did_not_respond',
          });
        }
      }),
    );

    const programs = await this.programsFor(candidates.map((c) => c.id));
    const maxNightly = input.maxNightly ? BigInt(input.maxNightly) : null;
    let results: SearchResult[] = [];
    for (const c of candidates) {
      const preferred = programs.get(c.id) ?? null;
      let rates = (ratesByProperty.get(c.id) ?? [])
        .filter((r) => r.total.currency === input.currency)
        .filter((r) => maxNightly === null || BigInt(r.nightlyAverage.amountMinor) <= maxNightly)
        .map((r) => ({
          ...r,
          partnerEligible: preferred
            ? preferred.rateCodes.length === 0 ||
              r.rateCodes.some((x) => preferred.rateCodes.includes(x))
            : false,
        }));
      if (rates.length === 0) continue;
      if (input.preferredOnly && !preferred) continue;
      rates = rates
        .sort((a, b) => Number(BigInt(a.total.amountMinor) - BigInt(b.total.amountMinor)))
        .slice(0, RATES_PER_PROPERTY);
      results.push({
        property: this.toSummary(c),
        preferred,
        fromNightly: rates[0]!.nightlyAverage,
        rates,
      });
    }
    const price = (r: SearchResult) => BigInt(r.fromNightly.amountMinor);
    results.sort((a, b) => {
      if (input.sort === 'stars')
        return b.property.starRating - a.property.starRating || Number(price(a) - price(b));
      if (input.sort === 'recommended' && Boolean(a.preferred) !== Boolean(b.preferred))
        return a.preferred ? -1 : 1;
      return Number(price(a) - price(b));
    });
    results = results.slice(0, input.limit);
    return {
      destination: { slug: dest.slug, name: dest.name },
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      nights,
      occupancy,
      currency: input.currency,
      results,
      warnings,
      tookMs: Date.now() - started,
    };
  }

  /** Rates are cached for minutes (ARCH caching); the final booking validation never uses the cache. */
  private async cachedRates(
    supplier: HotelSupplierPort,
    ids: string[],
    input: SearchInput,
    occupancy: Occupancy,
  ) {
    const key = `rates:${supplier.name}:${createHash('sha1')
      .update(
        JSON.stringify([
          ids.slice().sort(),
          input.checkIn,
          input.checkOut,
          occupancy,
          input.currency,
        ]),
      )
      .digest('hex')}`;
    if (this.redis.status === 'wait') await this.redis.connect().catch(() => undefined);
    const hit = await this.redis.get(key).catch(() => null);
    if (hit) return JSON.parse(hit) as { rates: SupplierRate[]; checkedAt: string };
    const rates = await this.call(supplier.name, 'searchRates', () =>
      supplier.searchRates({
        supplierPropertyIds: ids,
        checkIn: input.checkIn,
        checkOut: input.checkOut,
        occupancy,
        currency: input.currency,
      }),
    );
    const value = { rates, checkedAt: new Date().toISOString() };
    await this.redis
      .set(key, JSON.stringify(value), 'EX', RATE_CACHE_SECONDS)
      .catch(() => undefined);
    return value;
  }

  private toView(
    supplier: string,
    propertyId: string,
    r: SupplierRate,
    checkedAt: string,
  ): RateView {
    const { rateKey, supplierPropertyId: _ignored, ...rest } = r;
    const nights = nightsBetween(r.checkIn, r.checkOut);
    return {
      ...rest,
      rateKey: qualifyKey(supplier, rateKey),
      supplier,
      propertyId,
      nights,
      nightlyAverage: {
        amountMinor: String(BigInt(r.total.amountMinor) / BigInt(nights)),
        currency: r.total.currency,
      },
      partnerEligible: false,
      checkedAt,
    };
  }

  private toSummary(c: CandidateRow): PropertySummary {
    return {
      id: c.id,
      name: c.name,
      brand: c.brand,
      starRating: Number(c.star_rating),
      address: c.address,
      city: c.city,
      countryCode: c.country_code,
      lat: c.lat,
      lng: c.lng,
      amenities: c.amenities,
      description: c.description,
      photos: c.photos,
    };
  }

  private async programsFor(propertyIds: string[]): Promise<Map<string, Preferred>> {
    const rows = await this.db.read<{
      program_id: string;
      name: string;
      tier: string;
      perks: Perk[];
      rate_codes: string[];
      property_ids: string[];
    }>(
      'catalog',
      'SELECT * FROM catalog.partner_programs WHERE active AND property_ids && $1::uuid[]',
      [propertyIds],
    );
    const out = new Map<string, Preferred>();
    for (const r of rows) {
      for (const pid of r.property_ids) {
        if (!out.has(pid))
          out.set(pid, {
            programId: r.program_id,
            programName: r.name,
            tier: r.tier,
            perks: r.perks,
            rateCodes: r.rate_codes,
          });
      }
    }
    return out;
  }

  /** Re-price one offer now, bypassing the cache (FR-BKG-01, FR-ITN-05). Null when no longer available. */
  async checkRate(
    rateKey: string,
    currency: string,
  ): Promise<{ rate: RateView; property: PropertySummary; preferred: Preferred | null } | null> {
    const { supplier: supplierName, key } = splitKey(rateKey);
    const supplier = this.suppliers.find((s) => s.name === supplierName);
    if (!supplier) throw problem(HttpStatus.BAD_REQUEST, 'rate-key-invalid', 'Unknown rate');
    const r = await this.call(supplierName, 'checkRate', () => supplier.checkRate(key, currency));
    if (!r) return null;
    const [c] = await this.db.read<CandidateRow>(
      'catalog',
      `SELECT p.*, '[]'::json AS sources FROM catalog.property_sources s JOIN catalog.properties p ON p.id = s.property_id
        WHERE s.supplier = $1 AND s.supplier_property_id = $2`,
      [supplierName, r.supplierPropertyId],
    );
    if (!c) return null;
    const preferred = (await this.programsFor([c.id])).get(c.id) ?? null;
    const view = this.toView(supplierName, c.id, r, new Date().toISOString());
    view.partnerEligible = preferred
      ? preferred.rateCodes.length === 0 ||
        view.rateCodes.some((x) => preferred.rateCodes.includes(x))
      : false;
    return { rate: view, property: this.toSummary(c), preferred };
  }

  async getProperty(id: string): Promise<PropertySummary | null> {
    const [c] = await this.db.read<CandidateRow>(
      'catalog',
      `SELECT *, '[]'::json AS sources FROM catalog.properties WHERE id = $1`,
      [id],
    );
    return c ? this.toSummary(c) : null;
  }

  /** Name search across the catalog, for admin tools (picking partner properties). */
  async findProperties(q: string, limit = 20) {
    const rows = await this.db.read<CandidateRow & { suppliers: string[] }>(
      'catalog',
      `SELECT p.*, '[]'::json AS sources,
              (SELECT array_agg(supplier) FROM catalog.property_sources s WHERE s.property_id = p.id) AS suppliers
         FROM catalog.properties p
        WHERE p.name ILIKE '%' || $1 || '%' OR p.city ILIKE '%' || $1 || '%'
        ORDER BY similarity(p.name, $1) DESC, p.name LIMIT $2`,
      [q, limit],
    );
    return rows.map((r) => ({ ...this.toSummary(r), suppliers: r.suppliers ?? [] }));
  }
}
