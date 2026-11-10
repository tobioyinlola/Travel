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
import { createHash } from 'node:crypto';
import { MAX_ATTACHMENT_BYTES, safeFilename, sniffType } from '../domain/file-type.js';
import { ATTACHMENT_SCANNER, type AttachmentScannerPort } from './attachment-scan.port.js';
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

const MAX_ATTACHMENTS_PER_MESSAGE = 5;
const MAX_ATTACHMENTS_PER_TRIP = 25;
const TRAVELER_UPLOADS_PER_HOUR = 10;

interface AttachmentMeta {
  id: string;
  message_id: string | null;
  filename: string;
  content_type: string;
  size_bytes: number;
}
const attachmentView = (a: AttachmentMeta) => ({
  id: a.id,
  filename: a.filename,
  contentType: a.content_type,
  sizeBytes: a.size_bytes,
});

const view = (m: MessageRow, files: AttachmentMeta[] = []) => ({
  id: m.id,
  sender: m.sender,
  senderName: m.sender_name,
  body: m.body,
  createdAt: m.created_at.toISOString(),
  read: m.sender === 'advisor' || m.read_at !== null,
  attachments: files.filter((a) => a.message_id === m.id).map(attachmentView),
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
    @Inject(ATTACHMENT_SCANNER) private readonly scanner: AttachmentScannerPort,
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
    const files = await tx.query<AttachmentMeta>(
      `SELECT id, message_id, filename, content_type, size_bytes FROM itineraries.attachments
        WHERE trip_id = $1 AND message_id IS NOT NULL`,
      [tripId],
    );
    return {
      items: rows.map((m) => view(m, files)),
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

  async travelerPost(
    token: string,
    input: { name: string; body: string; attachmentIds?: string[] | undefined },
  ) {
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
      await this.attach(tx, p.trip_id, id, 'traveler', input.attachmentIds);
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

  async advisorPost(
    advisor: AdvisorSummary,
    tripId: string,
    body: string,
    attachmentIds?: string[] | undefined,
  ) {
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
      await this.attach(tx, tripId, id, 'advisor', attachmentIds);
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

  // ---------- Attachments (FR-TRV-06) ----------

  /** Links files this side uploaded earlier to the message being sent. Files must be unattached and on this trip. */
  private async attach(
    tx: Tx,
    tripId: string,
    messageId: string,
    uploader: 'traveler' | 'advisor',
    ids: string[] | undefined,
  ) {
    const unique = [...new Set(ids ?? [])];
    if (unique.length === 0) return;
    if (unique.length > MAX_ATTACHMENTS_PER_MESSAGE)
      throw problem(HttpStatus.BAD_REQUEST, 'too-many-files', 'Attach at most 5 files per message');
    const res = await tx.query(
      `UPDATE itineraries.attachments SET message_id = $3
        WHERE id = ANY($1::uuid[]) AND trip_id = $2 AND uploader = $4 AND message_id IS NULL RETURNING id`,
      [unique, tripId, messageId, uploader],
    );
    if (res.length !== unique.length)
      throw problem(
        HttpStatus.BAD_REQUEST,
        'bad-attachment',
        'One of the files cannot be attached',
        'Upload it again and retry.',
      );
  }

  /** The raw body parser only produces a Buffer for PDF, PNG and JPEG content types. */
  private asBytes(raw: unknown): Buffer {
    if (!Buffer.isBuffer(raw))
      throw problem(
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        'file-type-not-allowed',
        'Only PDF, PNG and JPEG files can be attached',
      );
    return raw;
  }

  /** Validates by content, scans, and stores. Returns the file's public details. */
  private async store(
    tx: Tx,
    trip: { id: string; owner: string },
    uploader: 'traveler' | 'advisor',
    filename: string,
    bytes: Buffer,
  ) {
    if (bytes.length === 0 || bytes.length > MAX_ATTACHMENT_BYTES)
      throw problem(
        HttpStatus.PAYLOAD_TOO_LARGE,
        'file-too-large',
        'The file must be between 1 byte and 5 MB',
      );
    const type = sniffType(bytes);
    if (!type)
      throw problem(
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
        'file-type-not-allowed',
        'Only PDF, PNG and JPEG files can be attached',
      );
    const [{ n } = { n: '0' }] = await tx.query<{ n: string }>(
      `SELECT count(*) AS n FROM itineraries.attachments WHERE trip_id = $1`,
      [trip.id],
    );
    if (Number(n) >= MAX_ATTACHMENTS_PER_TRIP)
      throw problem(
        HttpStatus.CONFLICT,
        'attachment-limit',
        'This trip has reached its file limit',
      );
    const scan = await this.scanner.scan(bytes);
    if (!scan.clean)
      throw problem(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'file-rejected',
        'This file was rejected by the safety scan',
      );
    const id = newId();
    const name = safeFilename(filename);
    await tx.query(
      `INSERT INTO itineraries.attachments (id, trip_id, owner_advisor_id, uploader, filename, content_type,
                                            size_bytes, sha256, scanner, data)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
      [
        id,
        trip.id,
        trip.owner,
        uploader,
        name,
        type,
        bytes.length,
        createHash('sha256').update(bytes).digest('hex'),
        this.scanner.name,
        bytes,
      ],
    );
    return { id, filename: name, contentType: type, sizeBytes: bytes.length };
  }

  async travelerUpload(token: string, filename: string, raw: unknown) {
    const bytes = this.asBytes(raw);
    if (this.redis.status === 'wait') await this.redis.connect();
    const key = `rl:trip-upload:${tokenHash(token)}`;
    const [[, n]] = (await this.redis.multi().incr(key).expire(key, 3600, 'NX').exec()) as [
      [unknown, number],
    ];
    if (n > TRAVELER_UPLOADS_PER_HOUR)
      throw problem(
        HttpStatus.TOO_MANY_REQUESTS,
        'rate-limited',
        'Too many files',
        'Please wait a while.',
      );
    return this.system(async (tx) => {
      const p = await this.tripOfToken(tx, token);
      return this.store(
        tx,
        { id: p.trip_id, owner: p.owner_advisor_id },
        'traveler',
        filename,
        bytes,
      );
    });
  }

  async advisorUpload(advisor: AdvisorSummary, tripId: string, filename: string, raw: unknown) {
    const bytes = this.asBytes(raw);
    return this.asAdvisor(advisor.id, async (tx) => {
      await this.assertOwnTrip(tx, tripId);
      return this.store(tx, { id: tripId, owner: advisor.id }, 'advisor', filename, bytes);
    });
  }

  private async load(tx: Tx, tripId: string, id: string) {
    const [a] = await tx.query<{ filename: string; content_type: string; data: Buffer }>(
      `SELECT filename, content_type, data FROM itineraries.attachments
        WHERE id = $1 AND trip_id = $2 AND message_id IS NOT NULL`,
      [id, tripId],
    );
    if (!a) throw problem(HttpStatus.NOT_FOUND, 'not-found', 'File not found');
    return { filename: a.filename, contentType: a.content_type, data: a.data };
  }

  async travelerDownload(token: string, id: string) {
    return this.system(async (tx) => {
      const p = await this.tripOfToken(tx, token);
      return this.load(tx, p.trip_id, id);
    });
  }

  async advisorDownload(advisorId: string, tripId: string, id: string) {
    return this.asAdvisor(advisorId, async (tx) => {
      await this.assertOwnTrip(tx, tripId);
      return this.load(tx, tripId, id);
    });
  }
}
