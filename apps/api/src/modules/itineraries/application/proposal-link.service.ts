import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { AuditWriter } from '../../../platform/audit/audit-writer.js';
import { Database } from '../../../platform/db/database.js';
import type { Tx } from '../../../platform/db/tx.js';
import { ProblemException, problemType } from '../../../platform/http/problem.js';
import { REDIS } from '../../../platform/tokens.js';
import type { ProposalTotals } from '../domain/totals.js';
import { tokenHash, type HotelSnapshot, type ProposalSnapshot } from './trips.service.js';

const problem = (status: HttpStatus, slug: string, title: string, detail?: string) =>
  new ProblemException(status, problemType(slug), title, detail);

const REQUESTS_PER_MINUTE = 60;

interface Row {
  id: string;
  trip_id: string;
  owner_advisor_id: string;
  advisor_user_id: string;
  version: number;
  status: 'published' | 'approved' | 'changes_requested' | 'declined' | 'superseded';
  snapshot: ProposalSnapshot;
  totals: ProposalTotals;
  token_expires_at: Date;
  rates_checked_at: Date;
  rates_expire_at: Date;
  decided_at: Date | null;
  decided_by_name: string | null;
  decision_note: string | null;
}

export type Decision = 'approve' | 'request_changes' | 'decline';

/** What a traveler may see: no rate keys, suppliers, commission or rate codes (FR-TRV-01/02). */
function travelerHotel(h: HotelSnapshot) {
  const r = h.rate;
  return {
    name: h.property.name,
    address: h.property.address,
    starRating: h.property.starRating,
    photo: h.property.photos[0] ?? null,
    amenities: h.property.amenities,
    checkIn: r.checkIn,
    checkOut: r.checkOut,
    nights: r.nights,
    roomName: r.roomName,
    board: r.board,
    refundable: r.refundable,
    cancellationPolicy: r.cancellationPolicy,
    total: r.total,
    taxes: r.taxes,
    feesAtHotel: r.feesAtHotel,
    perks: h.preferred && r.partnerEligible ? h.preferred.perks : [],
  };
}

/** The no-login proposal page (FR-ITN-04/06, FR-TRV-01..03, AC-02). */
@Injectable()
export class ProposalLinkService {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditWriter,
    @Inject(REDIS) private readonly redis: Redis,
  ) {}

  /** Link holders are anonymous: limit each address, so tokens cannot be guessed at scale. */
  async rateLimit(ip: string): Promise<void> {
    if (this.redis.status === 'wait') await this.redis.connect();
    const key = `rl:proposal-link:${ip}`;
    const [[, n]] = (await this.redis.multi().incr(key).expire(key, 60, 'NX').exec()) as [
      [unknown, number],
    ];
    if (n > REQUESTS_PER_MINUTE)
      throw problem(HttpStatus.TOO_MANY_REQUESTS, 'rate-limited', 'Too many requests');
  }

  /** Public reads use the all-rows scope; the token hash is the only key. */
  private system<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction('itineraries', async (tx) => {
      await tx.setLocal('atp.scope', 'all');
      return fn(tx);
    });
  }

  private async find(tx: Tx, token: string, lock = false): Promise<Row> {
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token))
      throw problem(HttpStatus.NOT_FOUND, 'not-found', 'This link is not valid');
    const [p] = await tx.query<Row>(
      `SELECT * FROM itineraries.proposals WHERE token_hash = $1 ${lock ? 'FOR UPDATE' : ''}`,
      [tokenHash(token)],
    );
    if (!p) throw problem(HttpStatus.NOT_FOUND, 'not-found', 'This link is not valid');
    if (p.token_expires_at <= new Date())
      throw problem(
        HttpStatus.GONE,
        'link-expired',
        'This link has expired',
        'Ask your advisor for a new one.',
      );
    return p;
  }

  async view(token: string) {
    return this.system(async (tx) => {
      const p = await this.find(tx, token);
      await tx.query(
        'UPDATE itineraries.proposals SET first_viewed_at = coalesce(first_viewed_at, now()) WHERE id = $1',
        [p.id],
      );
      const s = p.snapshot;
      return {
        version: p.version,
        status: p.status,
        title: s.trip.title,
        startDate: s.trip.startDate,
        endDate: s.trip.endDate,
        travelers: { adults: s.trip.adults, childrenAges: s.trip.childrenAges },
        clientFirstName: s.clientFirstName,
        advisorName: s.advisorName,
        items: s.items.map((i) => ({
          id: i.id,
          kind: i.kind,
          day: i.day,
          title: i.title,
          details: i.details,
          startTime: i.startTime,
          location: i.location,
          price: i.price === null ? null : { amountMinor: i.price, currency: s.trip.currency },
          hotel: i.hotel ? travelerHotel(i.hotel) : null,
        })),
        totals: p.totals,
        ratesCheckedAt: p.rates_checked_at.toISOString(),
        ratesExpireAt: p.rates_expire_at.toISOString(),
        ratesExpired: p.rates_expire_at <= new Date(),
        decidedAt: p.decided_at?.toISOString() ?? null,
        decidedByName: p.decided_by_name,
        decisionNote: p.decision_note,
      };
    });
  }

  /** AC-02: approval is timestamped, the version is locked, and the advisor is notified. */
  async decide(
    token: string,
    decision: Decision,
    input: { name: string; note?: string | undefined },
  ) {
    await this.system(async (tx) => {
      const p = await this.find(tx, token, true);
      if (p.status !== 'published') {
        throw problem(
          HttpStatus.CONFLICT,
          'already-decided',
          'This proposal has already been answered',
        );
      }
      if (decision === 'approve' && p.rates_expire_at <= new Date()) {
        throw problem(
          HttpStatus.CONFLICT,
          'prices-expired',
          'These prices have expired',
          'Your advisor needs to check the prices again before you can approve.',
        );
      }
      const status =
        decision === 'approve'
          ? 'approved'
          : decision === 'decline'
            ? 'declined'
            : 'changes_requested';
      await tx.query(
        `UPDATE itineraries.proposals SET status = $2, decided_at = now(), decided_by_name = $3, decision_note = $4 WHERE id = $1`,
        [p.id, status, input.name, input.note ?? null],
      );
      const [t] = (await tx.query<{
        client_id: string;
        title: string;
        start_date: string;
        end_date: string;
      }>(
        `UPDATE itineraries.trips SET status = $2, updated_at = now(), version = version + 1 WHERE id = $1
         RETURNING client_id, title, to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date`,
        [p.trip_id, decision === 'approve' ? 'approved' : 'planning'],
      )) as [{ client_id: string; title: string; start_date: string; end_date: string }];
      await tx.publish({
        type: 'TripUpdated',
        version: 1,
        payload: {
          tripId: p.trip_id,
          clientId: t.client_id,
          advisorId: p.owner_advisor_id,
          title: t.title,
          startDate: t.start_date,
          endDate: t.end_date,
          status: decision === 'approve' ? 'approved' : 'planning',
        },
      });
      await this.audit.record({
        actorType: 'user',
        actorId: null,
        action: `proposal.${status}`,
        entityType: 'trip',
        entityId: p.trip_id,
        module: 'itineraries',
        metadata: { proposalId: p.id, version: p.version, via: 'traveler_link' },
      });
      const base = {
        proposalId: p.id,
        tripId: p.trip_id,
        advisorId: p.owner_advisor_id,
        advisorUserId: p.advisor_user_id,
        tripTitle: t.title,
        decidedByName: input.name,
      };
      if (decision === 'approve') {
        await tx.publish({
          type: 'ProposalApproved',
          version: 1,
          payload: { ...base, proposalVersion: p.version },
        });
      } else if (decision === 'decline') {
        await tx.publish({
          type: 'ProposalDeclined',
          version: 1,
          payload: { ...base, note: input.note ?? '' },
        });
      } else {
        await tx.publish({
          type: 'ProposalChangesRequested',
          version: 1,
          payload: { ...base, note: input.note ?? '' },
        });
      }
    });
    return this.view(token);
  }
}
