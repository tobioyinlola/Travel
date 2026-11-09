import { HttpStatus, Injectable, OnModuleInit } from '@nestjs/common';
import { newId } from '../../shared-kernel/index.js';
import { IdentityApi, type AdvisorSummary } from '../../identity/index.js';
import { AuditWriter } from '../../../platform/audit/audit-writer.js';
import { Database } from '../../../platform/db/database.js';
import type { Tx } from '../../../platform/db/tx.js';
import { decodeCursor, toPage, type Page } from '../../../platform/http/pagination.js';
import { ProblemException, problemType } from '../../../platform/http/problem.js';
import { JobRegistry } from '../../../platform/jobs/job-registry.js';
import type { Preferences } from '../domain/preferences.js';

const problem = (status: HttpStatus, slug: string, title: string, detail?: string) =>
  new ProblemException(status, problemType(slug), title, detail);

/** The CRM is for members (approved or active advisors). */
const CRM_STATUSES = ['approved', 'active'] as const;
const PRIVACY_DAYS = 30;

export interface ClientInput {
  firstName: string;
  lastName: string;
  email?: string | null | undefined;
  phone?: string | null | undefined;
  dateOfBirth?: string | null | undefined;
  homeCity?: string | null | undefined;
  notes?: string | undefined;
  preferences?: Preferences | undefined;
}

export interface CompanionInput {
  firstName: string;
  lastName: string;
  relationship: string;
  dateOfBirth?: string | null | undefined;
  notes?: string | undefined;
}

interface ClientRow {
  id: string;
  owner_advisor_id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  home_city: string | null;
  notes: string;
  preferences: Preferences;
  status: 'active' | 'archived' | 'erased';
  created_at: Date;
  updated_at: Date;
  version: number;
}

const COLUMNS: Record<keyof ClientInput, string> = {
  firstName: 'first_name',
  lastName: 'last_name',
  email: 'email',
  phone: 'phone',
  dateOfBirth: 'date_of_birth',
  homeCity: 'home_city',
  notes: 'notes',
  preferences: 'preferences',
};

function summary(r: ClientRow) {
  return {
    id: r.id,
    firstName: r.first_name,
    lastName: r.last_name,
    email: r.email,
    phone: r.phone,
    homeCity: r.home_city,
    status: r.status,
    updatedAt: r.updated_at.toISOString(),
  };
}

export type ClientSummary = ReturnType<typeof summary>;

@Injectable()
export class ClientsService implements OnModuleInit {
  constructor(
    private readonly db: Database,
    private readonly identity: IdentityApi,
    private readonly audit: AuditWriter,
    private readonly jobs: JobRegistry,
  ) {}

  onModuleInit(): void {
    this.jobs.register<{ requestId: string }>({
      name: 'clients.process-privacy-request',
      module: 'clients',
      queue: 'default',
      handle: ({ requestId }) => this.processPrivacyRequest(requestId),
    });
    this.jobs.register({
      name: 'clients.purge-privacy-exports',
      module: 'clients',
      queue: 'bulk',
      cron: '20 4 * * *',
      handle: async () => {
        await this.asStaff((tx) =>
          tx.query(`UPDATE clients.privacy_requests SET export_payload = NULL
                     WHERE export_payload IS NOT NULL AND completed_at < now() - interval '30 days'`),
        );
      },
    });
  }

  advisorFor(userId: string): Promise<AdvisorSummary> {
    return this.identity.requireAdvisor(userId, CRM_STATUSES);
  }

  /** Every advisor-scoped unit of work: RLS sees only this advisor's rows (FR-CRM-07, AC-10). */
  private asAdvisor<T>(advisorId: string, fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction('clients', async (tx) => {
      await tx.setLocal('atp.advisor_id', advisorId);
      return fn(tx);
    });
  }

  /** Staff tools and background jobs: every row, always audited by the caller. */
  private asStaff<T>(fn: (tx: Tx) => Promise<T>): Promise<T> {
    return this.db.transaction('clients', async (tx) => {
      await tx.setLocal('atp.scope', 'all');
      return fn(tx);
    });
  }

  private async load(tx: Tx, id: string, lock = false): Promise<ClientRow> {
    // The explicit owner filter is the first line of defence; RLS is the second.
    const [r] = await tx.query<ClientRow>(
      `SELECT *, to_char(date_of_birth, 'YYYY-MM-DD') AS date_of_birth FROM clients.clients
        WHERE id = $1 AND owner_advisor_id = nullif(current_setting('atp.advisor_id', true), '')::uuid ${lock ? 'FOR UPDATE' : ''}`,
      [id],
    );
    if (!r || r.status === 'erased')
      throw problem(HttpStatus.NOT_FOUND, 'not-found', 'Client not found');
    return r;
  }

  // ---------- Clients (FR-CRM-01, 02) ----------

  async list(
    advisorId: string,
    f: {
      q?: string | undefined;
      status: 'active' | 'archived';
      limit: number;
      cursor?: string | undefined;
    },
  ): Promise<Page<ClientSummary>> {
    return this.asAdvisor(advisorId, async (tx) => {
      const params: unknown[] = [advisorId, f.status, f.limit + 1];
      const where = ['owner_advisor_id = $1', 'status = $2'];
      if (f.q) {
        params.push(`%${f.q.replace(/[%_\\]/g, '\\$&')}%`);
        where.push(
          `(first_name || ' ' || last_name || ' ' || coalesce(email::text, '')) ILIKE $${params.length}`,
        );
      }
      const cursor = decodeCursor(f.cursor);
      if (cursor) {
        params.push(cursor.sort, cursor.id);
        where.push(
          `(lower(last_name || ' ' || first_name), id) > ($${params.length - 1}, $${params.length}::uuid)`,
        );
      }
      const rows = await tx.query<ClientRow>(
        `SELECT * FROM clients.clients WHERE ${where.join(' AND ')}
          ORDER BY lower(last_name || ' ' || first_name), id LIMIT $3`,
        params,
      );
      return toPage(rows.map(summary), f.limit, (c) => ({
        sort: `${c.lastName} ${c.firstName}`.toLowerCase(),
        id: c.id,
      }));
    });
  }

  async create(advisorId: string, input: ClientInput) {
    const id = newId();
    await this.asAdvisor(advisorId, async (tx) => {
      await tx.query(
        `INSERT INTO clients.clients (id, owner_advisor_id, first_name, last_name, email, phone, date_of_birth, home_city, notes, preferences)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [
          id,
          advisorId,
          input.firstName,
          input.lastName,
          input.email ?? null,
          input.phone ?? null,
          input.dateOfBirth ?? null,
          input.homeCity ?? null,
          input.notes ?? '',
          JSON.stringify(input.preferences ?? {}),
        ],
      );
      // Audit without personal data: who, what, which record.
      await this.audit.record({
        actorType: 'user',
        action: 'client.created',
        entityType: 'client',
        entityId: id,
        module: 'clients',
      });
    });
    return this.get(advisorId, id);
  }

  async get(advisorId: string, id: string) {
    return this.asAdvisor(advisorId, async (tx) => {
      const c = await this.load(tx, id);
      const companions = await tx.query<Record<string, unknown>>(
        `SELECT id, first_name, last_name, relationship, to_char(date_of_birth, 'YYYY-MM-DD') AS dob, notes
           FROM clients.companions WHERE client_id = $1 ORDER BY created_at`,
        [id],
      );
      const trips = await tx.query<Record<string, unknown>>(
        `SELECT trip_id, title, to_char(start_date, 'YYYY-MM-DD') AS start_date, to_char(end_date, 'YYYY-MM-DD') AS end_date,
                status, booking_ids FROM clients.trip_history WHERE client_id = $1 ORDER BY start_date DESC NULLS LAST`,
        [id],
      );
      const privacy = await tx.query<Record<string, unknown>>(
        `SELECT id, kind, status, created_at, due_at, completed_at FROM clients.privacy_requests WHERE client_id = $1 ORDER BY created_at DESC`,
        [id],
      );
      return {
        ...summary(c),
        dateOfBirth: c.date_of_birth,
        notes: c.notes,
        preferences: c.preferences,
        version: c.version,
        createdAt: c.created_at.toISOString(),
        companions: companions.map((p) => ({
          id: p.id as string,
          firstName: p.first_name as string,
          lastName: p.last_name as string,
          relationship: p.relationship as string,
          dateOfBirth: (p.dob as string | null) ?? null,
          notes: p.notes as string,
        })),
        trips: trips.map((t) => ({
          tripId: t.trip_id as string,
          title: t.title as string,
          startDate: (t.start_date as string | null) ?? null,
          endDate: (t.end_date as string | null) ?? null,
          status: t.status as string,
          bookingIds: t.booking_ids as string[],
        })),
        privacyRequests: privacy.map((p) => ({
          id: p.id as string,
          kind: p.kind as 'export' | 'delete',
          status: p.status as string,
          createdAt: (p.created_at as Date).toISOString(),
          dueAt: (p.due_at as Date).toISOString(),
          completedAt: p.completed_at ? (p.completed_at as Date).toISOString() : null,
        })),
      };
    });
  }

  /** Optimistic locking (ARCH patterns): a stale `version` is refused with 409, never silently overwritten. */
  async update(advisorId: string, id: string, version: number, patch: Partial<ClientInput>) {
    await this.asAdvisor(advisorId, async (tx) => {
      const c = await this.load(tx, id, true);
      if (c.version !== version) {
        throw problem(
          HttpStatus.CONFLICT,
          'version-conflict',
          'This client was changed by someone else',
          'Reload to see the latest details, then apply your change again.',
        );
      }
      const keys = (Object.keys(patch) as Array<keyof ClientInput>).filter(
        (k) => patch[k] !== undefined,
      );
      if (keys.length === 0) return;
      const sets = keys.map((k, i) => `${COLUMNS[k]} = $${i + 2}`);
      const values = keys.map((k) => (k === 'preferences' ? JSON.stringify(patch[k]) : patch[k]));
      await tx.query(
        `UPDATE clients.clients SET ${sets.join(', ')}, updated_at = now(), version = version + 1 WHERE id = $1`,
        [id, ...values],
      );
      await this.audit.record({
        actorType: 'user',
        action: 'client.updated',
        entityType: 'client',
        entityId: id,
        module: 'clients',
        metadata: { fields: keys },
      });
    });
    return this.get(advisorId, id);
  }

  async setArchived(advisorId: string, id: string, archived: boolean) {
    await this.asAdvisor(advisorId, async (tx) => {
      await this.load(tx, id, true);
      await tx.query(
        `UPDATE clients.clients SET status = $2, updated_at = now(), version = version + 1 WHERE id = $1`,
        [id, archived ? 'archived' : 'active'],
      );
      await this.audit.record({
        actorType: 'user',
        action: archived ? 'client.archived' : 'client.restored',
        entityType: 'client',
        entityId: id,
        module: 'clients',
      });
    });
    return this.get(advisorId, id);
  }

  // ---------- Companions ----------

  async addCompanion(advisorId: string, clientId: string, input: CompanionInput) {
    await this.asAdvisor(advisorId, async (tx) => {
      await this.load(tx, clientId, true);
      await tx.query(
        `INSERT INTO clients.companions (id, client_id, owner_advisor_id, first_name, last_name, relationship, date_of_birth, notes)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          newId(),
          clientId,
          advisorId,
          input.firstName,
          input.lastName,
          input.relationship,
          input.dateOfBirth ?? null,
          input.notes ?? '',
        ],
      );
      await tx.query(
        'UPDATE clients.clients SET updated_at = now(), version = version + 1 WHERE id = $1',
        [clientId],
      );
    });
    return this.get(advisorId, clientId);
  }

  async removeCompanion(advisorId: string, clientId: string, companionId: string) {
    await this.asAdvisor(advisorId, async (tx) => {
      await this.load(tx, clientId, true);
      const rows = await tx.query(
        'DELETE FROM clients.companions WHERE id = $1 AND client_id = $2 RETURNING id',
        [companionId, clientId],
      );
      if (rows.length === 0)
        throw problem(HttpStatus.NOT_FOUND, 'not-found', 'Companion not found');
      await tx.query(
        'UPDATE clients.clients SET updated_at = now(), version = version + 1 WHERE id = $1',
        [clientId],
      );
    });
    return this.get(advisorId, clientId);
  }

  // ---------- Privacy requests (FR-CRM-08, NFR-10) ----------

  /** Logged by the advisor on the client's behalf; staff verify the requester before anything happens. */
  async requestPrivacy(
    advisorId: string,
    userId: string,
    clientId: string,
    kind: 'export' | 'delete',
    note: string,
  ) {
    const id = newId();
    await this.asAdvisor(advisorId, async (tx) => {
      await this.load(tx, clientId);
      try {
        await tx.query(
          `INSERT INTO clients.privacy_requests (id, client_id, owner_advisor_id, kind, requested_by, requester_note, due_at)
           VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(days => $7))`,
          [id, clientId, advisorId, kind, userId, note, PRIVACY_DAYS],
        );
      } catch (e) {
        if ((e as { code?: string }).code === '23505') {
          throw problem(
            HttpStatus.CONFLICT,
            'request-open',
            `An open ${kind} request already exists for this client`,
          );
        }
        throw e;
      }
      await this.audit.record({
        actorType: 'user',
        action: `privacy.${kind}_requested`,
        entityType: 'client',
        entityId: clientId,
        module: 'clients',
        metadata: { requestId: id },
      });
    });
    return { id };
  }

  async listPrivacyRequests(status?: string) {
    return this.asStaff(async (tx) => {
      const rows = await tx.query<Record<string, unknown>>(
        `SELECT r.id, r.client_id, r.owner_advisor_id, r.kind, r.status, r.requester_note, r.verification_note, r.rejected_reason,
                r.created_at, r.due_at, r.completed_at, (r.export_payload IS NOT NULL) AS has_export,
                c.first_name || ' ' || c.last_name AS client_name
           FROM clients.privacy_requests r JOIN clients.clients c ON c.id = r.client_id
          ${status ? 'WHERE r.status = $1' : ''} ORDER BY r.due_at`,
        status ? [status] : [],
      );
      return rows.map((r) => ({
        id: r.id as string,
        clientId: r.client_id as string,
        advisorId: r.owner_advisor_id as string,
        clientName: r.client_name as string,
        kind: r.kind as 'export' | 'delete',
        status: r.status as string,
        requesterNote: r.requester_note as string,
        verificationNote: (r.verification_note as string | null) ?? null,
        rejectedReason: (r.rejected_reason as string | null) ?? null,
        createdAt: (r.created_at as Date).toISOString(),
        dueAt: (r.due_at as Date).toISOString(),
        completedAt: r.completed_at ? (r.completed_at as Date).toISOString() : null,
        hasExport: r.has_export as boolean,
      }));
    });
  }

  async verifyPrivacyRequest(staffId: string, requestId: string, note: string) {
    await this.asStaff(async (tx) => {
      const rows = await tx.query<{ client_id: string; kind: string }>(
        `UPDATE clients.privacy_requests SET status = 'verified', verified_by = $2, verification_note = $3, verified_at = now()
          WHERE id = $1 AND status = 'requested' RETURNING client_id, kind`,
        [requestId, staffId, note],
      );
      if (!rows[0])
        throw problem(
          HttpStatus.CONFLICT,
          'not-pending',
          'This request is not waiting for verification',
        );
      await tx.enqueue(
        'clients.process-privacy-request',
        { requestId },
        { jobKey: `privacy:${requestId}` },
      );
      await this.audit.record({
        actorType: 'user',
        actorId: staffId,
        action: `privacy.${rows[0].kind}_verified`,
        entityType: 'client',
        entityId: rows[0].client_id,
        module: 'clients',
        metadata: { requestId },
      });
    });
  }

  async rejectPrivacyRequest(staffId: string, requestId: string, reason: string) {
    await this.asStaff(async (tx) => {
      const rows = await tx.query<{ client_id: string }>(
        `UPDATE clients.privacy_requests SET status = 'rejected', verified_by = $2, rejected_reason = $3, completed_at = now()
          WHERE id = $1 AND status = 'requested' RETURNING client_id`,
        [requestId, staffId, reason],
      );
      if (!rows[0])
        throw problem(
          HttpStatus.CONFLICT,
          'not-pending',
          'This request is not waiting for verification',
        );
      await this.audit.record({
        actorType: 'user',
        actorId: staffId,
        action: 'privacy.rejected',
        entityType: 'client',
        entityId: rows[0].client_id,
        module: 'clients',
        metadata: { requestId },
      });
    });
  }

  async exportFor(requestId: string): Promise<unknown> {
    return this.asStaff(async (tx) => {
      const [r] = await tx.query<{ export_payload: unknown; kind: string; status: string }>(
        'SELECT export_payload, kind, status FROM clients.privacy_requests WHERE id = $1',
        [requestId],
      );
      if (!r || r.kind !== 'export' || r.status !== 'completed' || !r.export_payload) {
        throw problem(HttpStatus.NOT_FOUND, 'not-found', 'No export available for this request');
      }
      return r.export_payload;
    });
  }

  /** Runs after verification: builds the export, or erases the client's personal data. */
  async processPrivacyRequest(requestId: string): Promise<void> {
    await this.asStaff(async (tx) => {
      const [r] = await tx.query<{
        client_id: string;
        owner_advisor_id: string;
        kind: 'export' | 'delete';
        status: string;
      }>(
        'SELECT client_id, owner_advisor_id, kind, status FROM clients.privacy_requests WHERE id = $1 FOR UPDATE',
        [requestId],
      );
      if (!r || r.status !== 'verified') return;
      if (r.kind === 'export') {
        const [client] = await tx.query(
          `SELECT first_name, last_name, email, phone, to_char(date_of_birth, 'YYYY-MM-DD') AS date_of_birth, home_city, notes,
                  preferences, created_at FROM clients.clients WHERE id = $1`,
          [r.client_id],
        );
        const companions = await tx.query(
          `SELECT first_name, last_name, relationship, to_char(date_of_birth, 'YYYY-MM-DD') AS date_of_birth, notes
             FROM clients.companions WHERE client_id = $1`,
          [r.client_id],
        );
        const trips = await tx.query(
          'SELECT title, start_date, end_date, status FROM clients.trip_history WHERE client_id = $1',
          [r.client_id],
        );
        const payload = { generatedAt: new Date().toISOString(), client, companions, trips };
        await tx.query(
          `UPDATE clients.privacy_requests SET status = 'completed', completed_at = now(), export_payload = $2 WHERE id = $1`,
          [requestId, JSON.stringify(payload)],
        );
      } else {
        await tx.query(
          `UPDATE clients.clients SET first_name = 'Erased', last_name = 'client', email = NULL, phone = NULL, date_of_birth = NULL,
                  home_city = NULL, notes = '', preferences = '{}', status = 'erased', erased_at = now(), updated_at = now(),
                  version = version + 1 WHERE id = $1`,
          [r.client_id],
        );
        await tx.query('DELETE FROM clients.companions WHERE client_id = $1', [r.client_id]);
        await tx.query(`UPDATE clients.trip_history SET title = 'Erased' WHERE client_id = $1`, [
          r.client_id,
        ]);
        await tx.query(
          `UPDATE clients.privacy_requests SET requester_note = '', status = 'completed', completed_at = now() WHERE id = $1`,
          [requestId],
        );
        // Other modules holding this client's data (proposals, bookings) erase it on this event.
        await tx.publish({
          type: 'ClientDataErased',
          version: 1,
          payload: {
            clientId: r.client_id,
            advisorId: r.owner_advisor_id,
            privacyRequestId: requestId,
          },
        });
      }
      await this.audit.record({
        actorType: 'system',
        actorId: null,
        action: `privacy.${r.kind}_completed`,
        entityType: 'client',
        entityId: r.client_id,
        module: 'clients',
        metadata: { requestId },
      });
    });
  }
}
