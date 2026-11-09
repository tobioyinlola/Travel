import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import { newId } from '../../shared-kernel/index.js';
import {
  CatalogApi,
  nightsBetween,
  type RateView,
  type PropertySummary,
  type Preferred,
} from '../../catalog/index.js';
import { ClientsApi } from '../../clients/index.js';
import { IdentityApi, type AdvisorSummary } from '../../identity/index.js';
import { APP_CONFIG, type AppConfig } from '../../../config.js';
import { AuditWriter } from '../../../platform/audit/audit-writer.js';
import { Database } from '../../../platform/db/database.js';
import type { Tx } from '../../../platform/db/tx.js';
import { ProblemException, problemType } from '../../../platform/http/problem.js';
import { FieldCrypto } from '../../../platform/security/field-crypto.js';
import { proposalTotals, type PricedItem, type ProposalTotals } from '../domain/totals.js';

const problem = (
  status: HttpStatus,
  slug: string,
  title: string,
  detail?: string,
  ext?: Record<string, unknown>,
) => new ProblemException(status, problemType(slug), title, detail, ext);

const PLANNER_STATUSES = ['approved', 'active'] as const;
const EDITABLE = new Set(['planning', 'proposed']);

export interface HotelSnapshot {
  rate: RateView;
  property: PropertySummary;
  preferred: Preferred | null;
}

export interface TripInput {
  clientId: string;
  title: string;
  startDate: string;
  endDate: string;
  adults: number;
  childrenAges: number[];
  currency: string;
  planningFeeMinor?: string | undefined;
  notes?: string | undefined;
}

export interface ItemInput {
  kind: 'activity' | 'transfer' | 'note';
  day: string;
  title: string;
  details?: string | undefined;
  startTime?: string | null | undefined;
  location?: string | null | undefined;
  priceMinor?: string | null | undefined;
}

interface TripRow {
  id: string;
  owner_advisor_id: string;
  client_id: string;
  title: string;
  start_date: string;
  end_date: string;
  adults: number;
  children_ages: number[];
  currency: string;
  planning_fee_minor: string;
  notes: string;
  status: 'planning' | 'proposed' | 'approved' | 'cancelled';
  version: number;
  updated_at: Date;
}

interface ItemRow {
  id: string;
  kind: 'hotel' | 'activity' | 'transfer' | 'note';
  day: string;
  position: number;
  title: string;
  details: string;
  start_time: string | null;
  location: string | null;
  price_minor: string | null;
  rate: HotelSnapshot | null;
}

interface ProposalRow {
  id: string;
  trip_id: string;
  owner_advisor_id: string;
  version: number;
  status: 'published' | 'approved' | 'changes_requested' | 'declined' | 'superseded';
  snapshot: ProposalSnapshot;
  totals: ProposalTotals;
  token_enc: string | null;
  token_expires_at: Date;
  rates_checked_at: Date;
  rates_expire_at: Date;
  published_at: Date;
  first_viewed_at: Date | null;
  decided_at: Date | null;
  decided_by_name: string | null;
  decision_note: string | null;
}

export interface ProposalSnapshot {
  trip: {
    id: string;
    title: string;
    startDate: string;
    endDate: string;
    adults: number;
    childrenAges: number[];
    currency: string;
  };
  clientFirstName: string;
  advisorName: string;
  items: Array<Omit<ReturnType<typeof itemView>, 'hotel'> & { hotel: HotelSnapshot | null }>;
}

const TRIP_COLUMNS = `id, owner_advisor_id, client_id, title, to_char(start_date, 'YYYY-MM-DD') AS start_date,
  to_char(end_date, 'YYYY-MM-DD') AS end_date, adults, children_ages, currency, planning_fee_minor, notes, status, version, updated_at`;
const TRIP_SELECT = `SELECT ${TRIP_COLUMNS} FROM itineraries.trips`;
const ITEM_SELECT = `SELECT id, kind, to_char(day, 'YYYY-MM-DD') AS day, position, title, details, start_time, location, price_minor, rate
  FROM itineraries.items`;

function itemView(i: ItemRow) {
  return {
    id: i.id,
    kind: i.kind,
    day: i.day,
    position: i.position,
    title: i.title,
    details: i.details,
    startTime: i.start_time,
    location: i.location,
    price: i.price_minor === null ? null : i.price_minor,
    hotel: i.rate,
  };
}

function priced(items: ItemRow[], currency: string): PricedItem[] {
  return items.map((i) =>
    i.kind === 'hotel' && i.rate
      ? {
          id: i.id,
          label: i.title,
          kind: 'hotel',
          amount: i.rate.rate.total,
          taxes: i.rate.rate.taxes,
          payableAtProperty: i.rate.rate.feesAtHotel,
        }
      : {
          id: i.id,
          label: i.title,
          kind: i.kind,
          amount: i.price_minor === null ? null : { amountMinor: i.price_minor, currency },
        },
  );
}

export const tokenHash = (token: string) => createHash('sha256').update(token).digest('hex');

/** Trips, itinerary building and proposal publishing for the signed-in advisor (FR-ITN-01..05). */
@Injectable()
export class TripsService {
  constructor(
    private readonly db: Database,
    private readonly identity: IdentityApi,
    private readonly clients: ClientsApi,
    private readonly catalog: CatalogApi,
    private readonly audit: AuditWriter,
    private readonly crypto: FieldCrypto,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  planner(userId: string): Promise<AdvisorSummary> {
    return this.identity.requireAdvisor(userId, PLANNER_STATUSES);
  }

  private asAdvisor<T>(advisorId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction('itineraries', async (tx) => {
      await tx.setLocal('atp.advisor_id', advisorId);
      return fn(tx);
    });
  }

  private async loadTrip(tx: Tx, tripId: string, lock = false): Promise<TripRow> {
    const [t] = await tx.query<TripRow>(
      `${TRIP_SELECT} WHERE id = $1 AND owner_advisor_id = nullif(current_setting('atp.advisor_id', true), '')::uuid ${lock ? 'FOR UPDATE' : ''}`,
      [tripId],
    );
    if (!t) throw problem(HttpStatus.NOT_FOUND, 'not-found', 'Trip not found');
    return t;
  }

  private assertEditable(t: TripRow): void {
    if (!EDITABLE.has(t.status)) {
      throw problem(
        HttpStatus.CONFLICT,
        'trip-locked',
        `This trip is ${t.status} and can no longer be edited`,
      );
    }
  }

  private async tripUpdated(
    tx: Tx,
    t: Pick<
      TripRow,
      'id' | 'client_id' | 'owner_advisor_id' | 'title' | 'start_date' | 'end_date' | 'status'
    >,
  ): Promise<void> {
    await tx.publish({
      type: 'TripUpdated',
      version: 1,
      payload: {
        tripId: t.id,
        clientId: t.client_id,
        advisorId: t.owner_advisor_id,
        title: t.title,
        startDate: t.start_date,
        endDate: t.end_date,
        status: t.status,
      },
    });
  }

  // ---------- Trips ----------

  async create(advisorId: string, input: TripInput) {
    if (input.endDate < input.startDate)
      throw problem(HttpStatus.BAD_REQUEST, 'dates-invalid', 'The trip ends before it starts');
    await this.clients.getContact(advisorId, input.clientId); // 404 unless it is this advisor's client
    const id = newId();
    await this.asAdvisor(advisorId, async (tx) => {
      const [t] = (await tx.query<TripRow>(
        `INSERT INTO itineraries.trips (id, owner_advisor_id, client_id, title, start_date, end_date, adults, children_ages, currency,
                                        planning_fee_minor, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING ${TRIP_COLUMNS}`,
        [
          id,
          advisorId,
          input.clientId,
          input.title,
          input.startDate,
          input.endDate,
          input.adults,
          input.childrenAges,
          input.currency,
          input.planningFeeMinor ?? '0',
          input.notes ?? '',
        ],
      )) as [TripRow];
      await this.audit.record({
        actorType: 'user',
        action: 'trip.created',
        entityType: 'trip',
        entityId: id,
        module: 'itineraries',
      });
      await this.tripUpdated(tx, t);
    });
    return this.get(advisorId, id);
  }

  /** Trip rows with what list screens show: client, destination, nights, party and current total. */
  async list(advisorId: string, f: { status?: string | undefined; clientId?: string | undefined }) {
    const rows = await this.asAdvisor(advisorId, async (tx) => {
      const params: unknown[] = [advisorId];
      const where = ['owner_advisor_id = $1'];
      if (f.status) where.push(`status = $${params.push(f.status)}`);
      if (f.clientId) where.push(`client_id = $${params.push(f.clientId)}`);
      const trips = await tx.query<TripRow>(
        `${TRIP_SELECT} WHERE ${where.join(' AND ')} ORDER BY trips.start_date, trips.id LIMIT 200`,
        params,
      );
      const items = trips.length
        ? await tx.query<ItemRow & { trip_id: string }>(
            `SELECT trip_id, id, kind, to_char(day, 'YYYY-MM-DD') AS day, position, title, details, start_time, location,
                    price_minor, rate
               FROM itineraries.items WHERE trip_id = ANY($1::uuid[]) ORDER BY items.day, items.position`,
            [trips.map((t) => t.id)],
          )
        : [];
      return trips.map((t) => ({ t, items: items.filter((i) => i.trip_id === t.id) }));
    });
    const names = await this.clients.getNames(advisorId, [
      ...new Set(rows.map((r) => r.t.client_id)),
    ]);
    return rows.map(({ t, items }) => {
      const hotel = items.find((i) => i.kind === 'hotel' && i.rate)?.rate ?? null;
      const n = names.get(t.client_id);
      return {
        id: t.id,
        clientId: t.client_id,
        clientName: n ? `${n.firstName} ${n.lastName}` : 'Erased client',
        title: t.title,
        startDate: t.start_date,
        endDate: t.end_date,
        nights: nightsBetween(t.start_date, t.end_date),
        travelers: t.adults + t.children_ages.length,
        status: t.status,
        currency: t.currency,
        destination: hotel
          ? { city: hotel.property.city, countryCode: hotel.property.countryCode }
          : null,
        total: proposalTotals(t.currency, priced(items, t.currency), BigInt(t.planning_fee_minor))
          .total,
        itemCount: items.length,
      };
    });
  }

  /** Advisor dashboard figures from this advisor's own trips (FR-RPT-01 preview; full reporting in Sprint 8). */
  async summary(advisorId: string) {
    const trips = await this.list(advisorId, {});
    const today = new Date().toISOString().slice(0, 10);
    const proposals = await this.asAdvisor(advisorId, (tx) =>
      tx.query<{ day: string; n: number }>(
        `SELECT to_char(published_at, 'YYYY-MM-DD') AS day, count(*)::int AS n FROM itineraries.proposals
          WHERE owner_advisor_id = $1 AND published_at > now() - interval '7 days' GROUP BY 1`,
        [advisorId],
      ),
    );
    const last7 = Array.from({ length: 7 }, (_, k) => {
      const d = new Date(Date.now() - (6 - k) * 86_400_000).toISOString().slice(0, 10);
      return { day: d, proposals: proposals.find((p) => p.day === d)?.n ?? 0 };
    });
    const currency = trips[0]?.currency ?? 'USD';
    const sum = (list: typeof trips) => ({
      amountMinor: String(
        list
          .filter((t) => t.total.currency === currency)
          .reduce((acc, t) => acc + BigInt(t.total.amountMinor), 0n),
      ),
      currency,
    });
    const destinations = new Map<
      string,
      { countryCode: string; city: string; trips: number; travelers: number }
    >();
    for (const t of trips) {
      if (!t.destination || t.status === 'cancelled') continue;
      const key = `${t.destination.countryCode}:${t.destination.city}`;
      const d = destinations.get(key) ?? { ...t.destination, trips: 0, travelers: 0 };
      d.trips += 1;
      d.travelers += t.travelers;
      destinations.set(key, d);
    }
    const active = trips.filter((t) => t.status !== 'cancelled');
    return {
      counts: {
        total: active.length,
        planning: trips.filter((t) => t.status === 'planning').length,
        proposed: trips.filter((t) => t.status === 'proposed').length,
        approved: trips.filter((t) => t.status === 'approved').length,
        upcoming: active.filter((t) => t.startDate >= today).length,
        travelingNow: active.filter((t) => t.startDate <= today && t.endDate >= today).length,
      },
      clients: await this.clients.countActive(advisorId),
      pipelineValue: sum(trips.filter((t) => t.status === 'proposed')),
      approvedValue: sum(trips.filter((t) => t.status === 'approved')),
      proposalsLast7Days: last7,
      destinations: [...destinations.values()].sort((a, b) => b.trips - a.trips),
      upcoming: active.filter((t) => t.endDate >= today).slice(0, 5),
    };
  }

  async get(advisorId: string, tripId: string) {
    const client = await this.asAdvisor(advisorId, (tx) => this.loadTrip(tx, tripId)).then((t) =>
      this.clients.getContact(advisorId, t.client_id).catch(() => null),
    );
    return this.asAdvisor(advisorId, async (tx) => {
      const t = await this.loadTrip(tx, tripId);
      const items = await tx.query<ItemRow>(
        `${ITEM_SELECT} WHERE trip_id = $1 ORDER BY items.day, items.position`,
        [tripId],
      );
      const proposals = await tx.query<ProposalRow>(
        `SELECT * FROM itineraries.proposals WHERE trip_id = $1 ORDER BY version DESC`,
        [tripId],
      );
      return {
        id: t.id,
        clientId: t.client_id,
        clientName: client ? `${client.firstName} ${client.lastName}` : 'Erased client',
        clientEmail: client?.email ?? null,
        title: t.title,
        startDate: t.start_date,
        endDate: t.end_date,
        adults: t.adults,
        childrenAges: t.children_ages,
        currency: t.currency,
        planningFee: { amountMinor: t.planning_fee_minor, currency: t.currency },
        notes: t.notes,
        status: t.status,
        version: t.version,
        items: items.map(itemView),
        totals: proposalTotals(t.currency, priced(items, t.currency), BigInt(t.planning_fee_minor)),
        proposals: proposals.map((p) => this.proposalSummary(p)),
      };
    });
  }

  private proposalSummary(p: ProposalRow) {
    const token = p.token_enc ? this.crypto.decrypt(p.token_enc) : null;
    return {
      id: p.id,
      version: p.version,
      status: p.status,
      total: p.totals.total,
      url: token && p.status !== 'superseded' ? `${this.config.WEB_BASE_URL}/p/${token}` : null,
      publishedAt: p.published_at.toISOString(),
      ratesCheckedAt: p.rates_checked_at.toISOString(),
      ratesExpireAt: p.rates_expire_at.toISOString(),
      linkExpiresAt: p.token_expires_at.toISOString(),
      firstViewedAt: p.first_viewed_at?.toISOString() ?? null,
      decidedAt: p.decided_at?.toISOString() ?? null,
      decidedByName: p.decided_by_name,
      decisionNote: p.decision_note,
    };
  }

  async update(
    advisorId: string,
    tripId: string,
    version: number,
    patch: Partial<Omit<TripInput, 'clientId' | 'currency'>>,
  ) {
    await this.asAdvisor(advisorId, async (tx) => {
      const t = await this.loadTrip(tx, tripId, true);
      this.assertEditable(t);
      if (t.version !== version)
        throw problem(
          HttpStatus.CONFLICT,
          'version-conflict',
          'This trip was changed by someone else',
        );
      const map: Record<string, string> = {
        title: 'title',
        startDate: 'start_date',
        endDate: 'end_date',
        adults: 'adults',
        childrenAges: 'children_ages',
        planningFeeMinor: 'planning_fee_minor',
        notes: 'notes',
      };
      const keys = Object.keys(patch).filter(
        (k) => patch[k as keyof typeof patch] !== undefined && map[k],
      );
      if (keys.length === 0) return;
      const [u] = (await tx.query<TripRow>(
        `UPDATE itineraries.trips SET ${[...keys.map((k, i) => `${map[k]} = $${i + 2}`), 'updated_at = now()', 'version = version + 1'].join(', ')}
          WHERE id = $1 RETURNING ${TRIP_COLUMNS}`,
        [tripId, ...keys.map((k) => patch[k as keyof typeof patch])],
      )) as [TripRow];
      if (u.end_date < u.start_date)
        throw problem(HttpStatus.BAD_REQUEST, 'dates-invalid', 'The trip ends before it starts');
      const outside = await tx.query(
        `SELECT 1 FROM itineraries.items WHERE trip_id = $1 AND (day < $2 OR day > $3) LIMIT 1`,
        [tripId, u.start_date, u.end_date],
      );
      if (outside.length)
        throw problem(
          HttpStatus.CONFLICT,
          'items-outside-dates',
          'Some items fall outside the new dates; move or remove them first',
        );
      await this.tripUpdated(tx, u);
    });
    return this.get(advisorId, tripId);
  }

  // ---------- Items (FR-ITN-01, 02) ----------

  private async nextPosition(tx: Tx, tripId: string, day: string): Promise<number> {
    const [r] = (await tx.query<{ p: number }>(
      'SELECT coalesce(max(position), 0) + 1 AS p FROM itineraries.items WHERE trip_id = $1 AND day = $2',
      [tripId, day],
    )) as [{ p: number }];
    return r.p;
  }

  async addItem(advisorId: string, tripId: string, input: ItemInput) {
    await this.asAdvisor(advisorId, async (tx) => {
      const t = await this.loadTrip(tx, tripId, true);
      this.assertEditable(t);
      if (input.day < t.start_date || input.day > t.end_date)
        throw problem(
          HttpStatus.BAD_REQUEST,
          'day-outside-trip',
          'That day is outside the trip dates',
        );
      await tx.query(
        `INSERT INTO itineraries.items (id, trip_id, owner_advisor_id, kind, day, position, title, details, start_time, location, price_minor)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
        [
          newId(),
          tripId,
          advisorId,
          input.kind,
          input.day,
          await this.nextPosition(tx, tripId, input.day),
          input.title,
          input.details ?? '',
          input.startTime ?? null,
          input.location ?? null,
          input.kind === 'note' ? null : (input.priceMinor ?? null),
        ],
      );
      await tx.query(
        'UPDATE itineraries.trips SET updated_at = now(), version = version + 1 WHERE id = $1',
        [tripId],
      );
    });
    return this.get(advisorId, tripId);
  }

  /** Adds a hotel offer from search, re-checked live so the itinerary never starts from a stale price. */
  async addHotel(advisorId: string, tripId: string, rateKey: string) {
    const trip = await this.asAdvisor(advisorId, (tx) => this.loadTrip(tx, tripId));
    this.assertEditable(trip);
    const live = await this.catalog.checkRate(rateKey, trip.currency);
    if (!live)
      throw problem(
        HttpStatus.CONFLICT,
        'rate-unavailable',
        'That room is no longer available',
        'Search again for current availability.',
      );
    const r = live.rate;
    if (r.checkIn < trip.start_date || r.checkOut > trip.end_date) {
      throw problem(
        HttpStatus.BAD_REQUEST,
        'stay-outside-trip',
        'The stay must fall within the trip dates',
      );
    }
    const sameParty =
      r.occupancy.adults === trip.adults &&
      [...r.occupancy.childrenAges].sort().join(',') === [...trip.children_ages].sort().join(',');
    if (!sameParty)
      throw problem(
        HttpStatus.BAD_REQUEST,
        'party-mismatch',
        'Search with the trip party (adults and children ages)',
      );
    const snapshot: HotelSnapshot = { rate: r, property: live.property, preferred: live.preferred };
    await this.asAdvisor(advisorId, async (tx) => {
      const t = await this.loadTrip(tx, tripId, true);
      this.assertEditable(t);
      await tx.query(
        `INSERT INTO itineraries.items (id, trip_id, owner_advisor_id, kind, day, position, title, details, location, rate)
         VALUES ($1, $2, $3, 'hotel', $4, $5, $6, $7, $8, $9)`,
        [
          newId(),
          tripId,
          advisorId,
          r.checkIn,
          await this.nextPosition(tx, tripId, r.checkIn),
          live.property.name,
          `${r.roomName}, ${r.board.replace('_', ' ')}, ${r.nights} night${r.nights === 1 ? '' : 's'}`,
          live.property.address,
          JSON.stringify(snapshot),
        ],
      );
      await tx.query(
        'UPDATE itineraries.trips SET updated_at = now(), version = version + 1 WHERE id = $1',
        [tripId],
      );
    });
    return this.get(advisorId, tripId);
  }

  async updateItem(
    advisorId: string,
    tripId: string,
    itemId: string,
    patch: Partial<Omit<ItemInput, 'kind'>> & { position?: number | undefined },
  ) {
    await this.asAdvisor(advisorId, async (tx) => {
      const t = await this.loadTrip(tx, tripId, true);
      this.assertEditable(t);
      const [item] = await tx.query<ItemRow>(`${ITEM_SELECT} WHERE id = $1 AND trip_id = $2`, [
        itemId,
        tripId,
      ]);
      if (!item) throw problem(HttpStatus.NOT_FOUND, 'not-found', 'Item not found');
      if (item.kind === 'hotel' && (patch.day !== undefined || patch.priceMinor !== undefined)) {
        throw problem(
          HttpStatus.BAD_REQUEST,
          'hotel-fixed',
          'Hotel dates and prices come from the rate; remove it and add a new one',
        );
      }
      if (patch.day && (patch.day < t.start_date || patch.day > t.end_date)) {
        throw problem(
          HttpStatus.BAD_REQUEST,
          'day-outside-trip',
          'That day is outside the trip dates',
        );
      }
      const map: Record<string, string> = {
        day: 'day',
        title: 'title',
        details: 'details',
        startTime: 'start_time',
        location: 'location',
        priceMinor: 'price_minor',
        position: 'position',
      };
      const keys = Object.keys(patch).filter(
        (k) => patch[k as keyof typeof patch] !== undefined && map[k],
      );
      if (keys.length === 0) return;
      await tx.query(
        `UPDATE itineraries.items SET ${[...keys.map((k, i) => `${map[k]} = $${i + 2}`), 'updated_at = now()'].join(', ')} WHERE id = $1`,
        [itemId, ...keys.map((k) => patch[k as keyof typeof patch])],
      );
      await tx.query(
        'UPDATE itineraries.trips SET updated_at = now(), version = version + 1 WHERE id = $1',
        [tripId],
      );
    });
    return this.get(advisorId, tripId);
  }

  async removeItem(advisorId: string, tripId: string, itemId: string) {
    await this.asAdvisor(advisorId, async (tx) => {
      const t = await this.loadTrip(tx, tripId, true);
      this.assertEditable(t);
      const rows = await tx.query(
        'DELETE FROM itineraries.items WHERE id = $1 AND trip_id = $2 RETURNING id',
        [itemId, tripId],
      );
      if (rows.length === 0) throw problem(HttpStatus.NOT_FOUND, 'not-found', 'Item not found');
      await tx.query(
        'UPDATE itineraries.trips SET updated_at = now(), version = version + 1 WHERE id = $1',
        [tripId],
      );
    });
    return this.get(advisorId, tripId);
  }

  // ---------- Publishing (FR-ITN-04, 05) ----------

  /** Re-prices every hotel live (outside any transaction). Throws if any is sold out. */
  private async recheck(trip: TripRow, items: ItemRow[]) {
    const changes: Array<{ itemId: string; title: string; before: string; after: string }> = [];
    const unavailable: string[] = [];
    const updated = new Map<string, HotelSnapshot>();
    for (const i of items) {
      if (i.kind !== 'hotel' || !i.rate) continue;
      const live = await this.catalog.checkRate(i.rate.rate.rateKey, trip.currency);
      if (!live) {
        unavailable.push(i.title);
        continue;
      }
      if (live.rate.total.amountMinor !== i.rate.rate.total.amountMinor) {
        changes.push({
          itemId: i.id,
          title: i.title,
          before: i.rate.rate.total.amountMinor,
          after: live.rate.total.amountMinor,
        });
      }
      updated.set(i.id, { rate: live.rate, property: live.property, preferred: live.preferred });
    }
    if (unavailable.length) {
      throw problem(
        HttpStatus.CONFLICT,
        'rates-unavailable',
        'Some hotels are no longer available',
        `Replace: ${unavailable.join(', ')}.`,
        { unavailable },
      );
    }
    return { changes, updated };
  }

  async publish(advisor: AdvisorSummary, tripId: string, opts: { sendEmail: boolean }) {
    const trip = await this.asAdvisor(advisor.id, (tx) => this.loadTrip(tx, tripId));
    this.assertEditable(trip);
    const items = await this.asAdvisor(advisor.id, (tx) =>
      tx.query<ItemRow>(`${ITEM_SELECT} WHERE trip_id = $1 ORDER BY items.day, items.position`, [
        tripId,
      ]),
    );
    if (items.length === 0)
      throw problem(HttpStatus.BAD_REQUEST, 'empty-itinerary', 'Add at least one item first');
    const contact = await this.clients.getContact(advisor.id, trip.client_id);
    const advisorName = await this.identity.getDisplayName(advisor.userId);
    const { changes, updated } = await this.recheck(trip, items);

    const result = await this.asAdvisor(advisor.id, async (tx) => {
      // Keep the traveler's link working across versions: reuse the current token while it is valid.
      const [current] = await tx.query<{ token_enc: string | null; token_expires_at: Date }>(
        `SELECT token_enc, token_expires_at FROM itineraries.proposals WHERE trip_id = $1 AND status <> 'superseded'
          ORDER BY version DESC LIMIT 1`,
        [tripId],
      );
      const token =
        current?.token_enc && current.token_expires_at > new Date()
          ? this.crypto.decrypt(current.token_enc)
          : randomBytes(32).toString('base64url');
      const t = await this.loadTrip(tx, tripId, true);
      this.assertEditable(t);
      for (const [itemId, snap] of updated) {
        await tx.query('UPDATE itineraries.items SET rate = $2, updated_at = now() WHERE id = $1', [
          itemId,
          JSON.stringify(snap),
        ]);
      }
      const fresh = await tx.query<ItemRow>(
        `${ITEM_SELECT} WHERE trip_id = $1 ORDER BY items.day, items.position`,
        [tripId],
      );
      const totals = proposalTotals(
        t.currency,
        priced(fresh, t.currency),
        BigInt(t.planning_fee_minor),
      );
      const snapshot: ProposalSnapshot = {
        trip: {
          id: t.id,
          title: t.title,
          startDate: t.start_date,
          endDate: t.end_date,
          adults: t.adults,
          childrenAges: t.children_ages,
          currency: t.currency,
        },
        clientFirstName: contact.firstName,
        advisorName,
        items: fresh.map(itemView),
      };
      await tx.query(
        `UPDATE itineraries.proposals SET status = 'superseded', token_hash = NULL WHERE trip_id = $1 AND status <> 'superseded'`,
        [tripId],
      );
      const [{ v }] = (await tx.query<{ v: number }>(
        'SELECT coalesce(max(version), 0) + 1 AS v FROM itineraries.proposals WHERE trip_id = $1',
        [tripId],
      )) as [{ v: number }];
      const id = newId();
      const ttl = this.config.PROPOSAL_RATE_TTL_HOURS;
      const [p] = (await tx.query<ProposalRow>(
        `INSERT INTO itineraries.proposals (id, trip_id, owner_advisor_id, advisor_user_id, version, status, snapshot, totals, token_hash,
                                            token_enc, token_expires_at, rates_checked_at, rates_expire_at)
         VALUES ($1, $2, $3, $4, $5, 'published', $6, $7, $8, $9, now() + make_interval(days => $10), now(), now() + make_interval(hours => $11))
         RETURNING *`,
        [
          id,
          tripId,
          advisor.id,
          advisor.userId,
          v,
          JSON.stringify(snapshot),
          JSON.stringify(totals),
          tokenHash(token),
          this.crypto.encrypt(token),
          this.config.PROPOSAL_LINK_DAYS,
          ttl,
        ],
      )) as [ProposalRow];
      await tx.query(
        `UPDATE itineraries.trips SET status = 'proposed', updated_at = now(), version = version + 1 WHERE id = $1`,
        [tripId],
      );
      await this.tripUpdated(tx, { ...t, status: 'proposed' });
      await this.audit.record({
        actorType: 'user',
        action: 'proposal.published',
        entityType: 'trip',
        entityId: tripId,
        module: 'itineraries',
        metadata: { proposalId: id, version: v, priceChanges: changes.length },
      });
      await tx.publish({
        type: 'ProposalPublished',
        version: 1,
        payload: {
          proposalId: id,
          proposalVersion: v,
          tripId,
          advisorId: advisor.id,
          advisorUserId: advisor.userId,
        },
      });
      const url = `${this.config.WEB_BASE_URL}/p/${token}`;
      if (opts.sendEmail) {
        if (!contact.email)
          throw problem(
            HttpStatus.BAD_REQUEST,
            'no-client-email',
            'This client has no email address; copy the link instead',
          );
        await tx.publish({
          type: 'ProposalSent',
          version: 1,
          payload: {
            proposalId: id,
            advisorId: advisor.id,
            advisorName,
            recipientEmail: contact.email,
            recipientName: contact.firstName,
            url,
            expiresAt: p.token_expires_at.toISOString(),
          },
        });
      }
      return { proposal: this.proposalSummary(p), priceChanges: changes };
    });
    return result;
  }

  /**
   * FR-ITN-05: re-check every hotel price. Unchanged: the current proposal's prices are valid for another
   * period. Changed: a new proposal version is published on the same link, showing the new prices.
   */
  async refreshPrices(advisor: AdvisorSummary, tripId: string) {
    const trip = await this.asAdvisor(advisor.id, (tx) => this.loadTrip(tx, tripId));
    const items = await this.asAdvisor(advisor.id, (tx) =>
      tx.query<ItemRow>(`${ITEM_SELECT} WHERE trip_id = $1 ORDER BY items.day, items.position`, [
        tripId,
      ]),
    );
    const current = await this.asAdvisor(advisor.id, (tx) =>
      tx.query<ProposalRow>(
        `SELECT * FROM itineraries.proposals WHERE trip_id = $1 AND status = 'published' ORDER BY version DESC LIMIT 1`,
        [tripId],
      ),
    );
    if (!current[0])
      throw problem(
        HttpStatus.CONFLICT,
        'no-open-proposal',
        'There is no proposal waiting for the traveler',
      );
    const { changes } = await this.recheck(trip, items);
    if (changes.length === 0) {
      const [p] = await this.asAdvisor(advisor.id, (tx) =>
        tx.query<ProposalRow>(
          `UPDATE itineraries.proposals SET rates_checked_at = now(), rates_expire_at = now() + make_interval(hours => $2)
            WHERE id = $1 AND status = 'published' RETURNING *`,
          [current[0]!.id, this.config.PROPOSAL_RATE_TTL_HOURS],
        ),
      );
      return {
        proposal: this.proposalSummary(p!),
        priceChanges: [] as typeof changes,
        republished: false,
      };
    }
    const published = await this.publish(advisor, tripId, { sendEmail: false });
    return { ...published, republished: true };
  }
}
