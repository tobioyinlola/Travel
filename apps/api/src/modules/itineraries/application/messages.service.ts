import { HttpStatus, Inject, Injectable } from '@nestjs/common';
import type { Redis } from 'ioredis';
import { newId } from '../../shared-kernel/index.js';
import { ClientsApi } from '../../clients/index.js';
import { IdentityApi, type AdvisorSummary } from '../../identity/index.js';
import { APP_CONFIG, type AppConfig } from '../../../config.js';
import { AuditWriter } from '../../../platform/audit/audit-writer.js';
import { Database } from '../../../platform/db/database.js';
import type { Tx } from '../../../platform/db/tx.js';
import { ProblemException, problemType } from '../../../platform/http/problem.js';
import { FieldCrypto } from '../../../platform/security/field-crypto.js';
import { REDIS } from '../../../platform/tokens.js';
import { tokenHash } from './trips.service.js';

const problem = (status: HttpStatus, slug: string, title: string, detail?: string) =>
  new ProblemException(status, problemType(slug), title, detail);

/** A traveler may post this many messages per hour per link: enough to talk, too few to spam an advisor. */
const TRAVELER_MESSAGES_PER_HOUR = 20;
const PLANNER_STATUSES = ['approved', 'active'] as const;

interface MessageRow {
  id: string;
  sender: 'traveler' | 'advisor';
  sender_name: string;
  body: string;
  created_at: Date;
  read_at: Date | null;
}

const view = (m: MessageRow) => ({
  id: m.id,
  sender: m.sender,
  senderName: m.sender_name,
  body: m.body,
  createdAt: m.created_at.toISOString(),
  read: m.sender === 'advisor' || m.read_at !== null,
});

/** The conversation between a traveler (no account, proposal link) and their advisor (FR-TRV-06). */
@Injectable()
export class MessagesService {
  constructor(
    private readonly db: Database,
    private readonly identity: IdentityApi,
    private readonly clients: ClientsApi,
    private readonly audit: AuditWriter,
    private readonly crypto: FieldCrypto,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(REDIS) private readonly redis: Redis,
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

  private system<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction('itineraries', async (tx) => {
      await tx.setLocal('atp.scope', 'all');
      return fn(tx);
    });
  }

  /** Resolves a traveler link token to its trip. Any proposal version of the trip works, until it expires. */
  private async tripOfToken(tx: Tx, token: string) {
    if (!/^[A-Za-z0-9_-]{40,60}$/.test(token))
      throw problem(HttpStatus.NOT_FOUND, 'not-found', 'This link is not valid');
    const [p] = await tx.query<{
      trip_id: string;
      owner_advisor_id: string;
      advisor_user_id: string;
      token_expires_at: Date;
      title: string;
      client_first_name: string;
    }>(
      `SELECT p.trip_id, p.owner_advisor_id, p.advisor_user_id, p.token_expires_at,
              t.title, p.snapshot->>'clientFirstName' AS client_first_name
         FROM itineraries.proposals p JOIN itineraries.trips t ON t.id = p.trip_id
        WHERE p.token_hash = $1`,
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

  private async thread(tx: Tx, tripId: string) {
    const rows = await tx.query<MessageRow>(
      `SELECT id, sender, sender_name, body, created_at, read_at FROM itineraries.messages
        WHERE trip_id = $1 ORDER BY created_at, id`,
      [tripId],
    );
    return {
      items: rows.map(view),
      unread: rows.filter((m) => m.sender === 'traveler' && !m.read_at).length,
    };
  }

  // ---------- Traveler side (the link is the credential) ----------

  async travelerThread(token: string) {
    return this.system(async (tx) => {
      const p = await this.tripOfToken(tx, token);
      return this.thread(tx, p.trip_id);
    });
  }

  async travelerPost(token: string, input: { name: string; body: string }) {
    if (this.redis.status === 'wait') await this.redis.connect();
    const key = `rl:trip-message:${tokenHash(token)}`;
    const [[, n]] = (await this.redis.multi().incr(key).expire(key, 3600, 'NX').exec()) as [
      [unknown, number],
    ];
    if (n > TRAVELER_MESSAGES_PER_HOUR)
      throw problem(
        HttpStatus.TOO_MANY_REQUESTS,
        'rate-limited',
        'Too many messages',
        'Please wait a while before sending more.',
      );
    return this.system(async (tx) => {
      const p = await this.tripOfToken(tx, token);
      const id = newId();
      await tx.query(
        `INSERT INTO itineraries.messages (id, trip_id, owner_advisor_id, sender, sender_name, body)
         VALUES ($1, $2, $3, 'traveler', $4, $5)`,
        [id, p.trip_id, p.owner_advisor_id, input.name, input.body],
      );
      await tx.publish({
        type: 'TripMessageReceived',
        version: 1,
        payload: {
          messageId: id,
          tripId: p.trip_id,
          advisorId: p.owner_advisor_id,
          advisorUserId: p.advisor_user_id,
          tripTitle: p.title,
          senderName: input.name,
        },
      });
      return this.thread(tx, p.trip_id);
    });
  }

  // ---------- Advisor side ----------

  async advisorThread(advisorId: string, tripId: string) {
    return this.asAdvisor(advisorId, async (tx) => {
      await this.assertOwnTrip(tx, tripId);
      return this.thread(tx, tripId);
    });
  }

  async markRead(advisorId: string, tripId: string) {
    await this.asAdvisor(advisorId, async (tx) => {
      await this.assertOwnTrip(tx, tripId);
      await tx.query(
        `UPDATE itineraries.messages SET read_at = now()
          WHERE trip_id = $1 AND sender = 'traveler' AND read_at IS NULL`,
        [tripId],
      );
    });
  }

  async unreadTotal(advisorId: string): Promise<number> {
    return this.asAdvisor(advisorId, async (tx) => {
      const [r] = await tx.query<{ n: string }>(
        `SELECT count(*) AS n FROM itineraries.messages
          WHERE sender = 'traveler' AND read_at IS NULL
            AND owner_advisor_id = nullif(current_setting('atp.advisor_id', true), '')::uuid`,
      );
      return Number(r?.n ?? 0);
    });
  }

  private async assertOwnTrip(tx: Tx, tripId: string) {
    const [t] = await tx.query<{ client_id: string; title: string }>(
      `SELECT client_id, title FROM itineraries.trips
        WHERE id = $1 AND owner_advisor_id = nullif(current_setting('atp.advisor_id', true), '')::uuid`,
      [tripId],
    );
    if (!t) throw problem(HttpStatus.NOT_FOUND, 'not-found', 'Trip not found');
    return t;
  }

  async advisorPost(advisor: AdvisorSummary, tripId: string, body: string) {
    const advisorName = await this.identity.getDisplayName(advisor.userId);
    const trip = await this.asAdvisor(advisor.id, (tx) => this.assertOwnTrip(tx, tripId));
    const contact = await this.clients.getContact(advisor.id, trip.client_id);
    return this.asAdvisor(advisor.id, async (tx) => {
      const id = newId();
      await tx.query(
        `INSERT INTO itineraries.messages (id, trip_id, owner_advisor_id, sender, sender_name, body, read_at)
         VALUES ($1, $2, $3, 'advisor', $4, $5, now())`,
        [id, tripId, advisor.id, advisorName, body],
      );
      // Email the traveler a pointer to their private page, when there is a live link and an address.
      const [current] = await tx.query<{ token_enc: string | null; token_expires_at: Date }>(
        `SELECT token_enc, token_expires_at FROM itineraries.proposals
          WHERE trip_id = $1 AND status <> 'superseded' ORDER BY version DESC LIMIT 1`,
        [tripId],
      );
      if (contact.email && current?.token_enc && current.token_expires_at > new Date()) {
        await tx.publish({
          type: 'TripMessageReplied',
          version: 1,
          payload: {
            messageId: id,
            tripId,
            advisorId: advisor.id,
            advisorName,
            recipientEmail: contact.email,
            recipientName: contact.firstName,
            tripTitle: trip.title,
            url: `${this.config.WEB_BASE_URL}/p/${this.crypto.decrypt(current.token_enc)}`,
          },
        });
      }
      await this.audit.record({
        actorType: 'user',
        actorId: advisor.userId,
        action: 'trip.message_sent',
        entityType: 'trip',
        entityId: tripId,
        module: 'itineraries',
        metadata: { messageId: id },
      });
      return this.thread(tx, tripId);
    });
  }
}
