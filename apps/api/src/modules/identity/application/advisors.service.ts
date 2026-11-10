import { HttpStatus, Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { newId } from '../../shared-kernel/index.js';
import { AuditWriter } from '../../../platform/audit/audit-writer.js';
import { requestContext } from '../../../platform/context/request-context.js';
import { FieldCrypto } from '../../../platform/security/field-crypto.js';
import { Database } from '../../../platform/db/database.js';
import type { Tx } from '../../../platform/db/tx.js';
import { decodeCursor, toPage, type Page } from '../../../platform/http/pagination.js';
import { AuthService } from './auth.service.js';
import { ProblemException, problemType } from '../../../platform/http/problem.js';
import { JobRegistry } from '../../../platform/jobs/job-registry.js';
import { WebhookRegistry } from '../../../platform/webhooks/webhooks.js';
import {
  advisorLifecycle,
  type AdvisorEvent,
  type AdvisorStatus,
} from '../domain/advisor-status.js';
import { fakeEsignWebhook, fakeKycWebhook } from '../infrastructure/fake-providers.js';
import {
  AGREEMENT_VERSION,
  IDENTITY_VERIFICATION_PORT,
  SIGNATURE_PORT,
  type IdentityVerificationPort,
  type KycResult,
  type ProviderResultSink,
  type SignaturePort,
  type SignatureResult,
} from './ports.js';

export interface ApplicationInput {
  legalName: string;
  country: string;
  address: {
    line1: string;
    line2?: string | undefined;
    city: string;
    region?: string | undefined;
    postalCode?: string | undefined;
  };
  taxResidency: string;
  experience: 'none' | 'some' | 'professional';
  niche: string;
  /** Optional. Encrypted at rest, never written to the audit log, events or responses. */
  taxId?: string | undefined;
}

interface AdvisorRow {
  id: string;
  user_id: string;
  status: AdvisorStatus;
  legal_name: string;
  country: string;
  address: ApplicationInput['address'];
  tax_residency: string;
  experience: ApplicationInput['experience'];
  niche: string;
  submitted_at: Date;
  info_request_note: string | null;
  kyc_status: 'not_started' | 'pending' | 'passed' | 'failed';
  kyc_redirect_url: string | null;
  kyc_checked_at: Date | null;
  agreement_status: 'not_sent' | 'sent' | 'signed' | 'declined';
  agreement_version: string | null;
  agreement_signing_url: string | null;
  agreement_document_ref: string | null;
  agreement_signed_at: Date | null;
  accepted_at: Date | null;
  approved_at: Date | null;
  tax_id_last4: string | null;
  essentials_passed_at: Date | null;
  activated_at: Date | null;
  version: number;
}

/** What other modules and the admin console see. Plain data, never the row (ARCH rule 3). */
export interface AdvisorSummary {
  id: string;
  userId: string;
  status: AdvisorStatus;
  legalName: string;
  country: string;
  acceptedAt: string | null;
  approvedAt: string | null;
  essentialsPassedAt: string | null;
}

export interface AdvisorApplicationView extends AdvisorSummary {
  address: ApplicationInput['address'];
  taxResidency: string;
  experience: ApplicationInput['experience'];
  niche: string;
  taxId: { provided: boolean; last4: string | null };
  submittedAt: string;
  infoRequestNote: string | null;
  kyc: { status: AdvisorRow['kyc_status']; redirectUrl: string | null; checkedAt: string | null };
  agreement: {
    status: AdvisorRow['agreement_status'];
    version: string | null;
    signingUrl: string | null;
    signedAt: string | null;
    documentRef: string | null;
  };
}

export type ReviewDecision = 'accept' | 'reject' | 'request_info';

const iso = (d: Date | null) => (d ? d.toISOString() : null);
const problem = (status: HttpStatus, slug: string, title: string, detail?: string) =>
  new ProblemException(status, problemType(slug), title, detail);

@Injectable()
export class AdvisorsService implements OnModuleInit, ProviderResultSink {
  constructor(
    private readonly db: Database,
    private readonly audit: AuditWriter,
    private readonly jobs: JobRegistry,
    private readonly webhooks: WebhookRegistry,
    @Inject(IDENTITY_VERIFICATION_PORT) private readonly kyc: IdentityVerificationPort,
    @Inject(SIGNATURE_PORT) private readonly esign: SignaturePort,
    private readonly auth: AuthService,
    private readonly crypto: FieldCrypto,
  ) {}

  onModuleInit(): void {
    // External calls never run inside a DB transaction (ARCH rule 7): submission enqueues this job.
    this.jobs.register<{ advisorId: string }>({
      name: 'identity.start-checks',
      module: 'identity',
      queue: 'critical',
      handle: ({ advisorId }) => this.startChecks(advisorId),
    });
    if (this.kyc.provider === 'fake-kyc') this.webhooks.register(fakeKycWebhook(this));
    if (this.esign.provider === 'fake-esign') this.webhooks.register(fakeEsignWebhook(this));
  }

  // ---------- Application (FR-AUTH-03) ----------

  async submitApplication(
    userId: string,
    submitted: ApplicationInput,
  ): Promise<AdvisorApplicationView> {
    // The tax identifier is kept out of `input`, which goes to the audit log.
    const { taxId, ...input } = submitted;
    const taxValues = taxId
      ? [this.crypto.encrypt(taxId), taxId.replace(/[^A-Za-z0-9]/g, '').slice(-4)]
      : null;
    const advisorId = await this.db.transaction('identity', async (tx) => {
      const [existing] = await tx.query<AdvisorRow>(
        'SELECT * FROM identity.advisors WHERE user_id = $1 FOR UPDATE',
        [userId],
      );
      if (existing && existing.status !== 'applied') {
        throw problem(
          HttpStatus.CONFLICT,
          'application-locked',
          'Your application can no longer be edited',
          `Current status: ${existing.status}.`,
        );
      }
      const values = [
        input.legalName,
        input.country.toUpperCase(),
        JSON.stringify(input.address),
        input.taxResidency.toUpperCase(),
        input.experience,
        input.niche,
      ];
      if (existing) {
        await tx.query(
          `UPDATE identity.advisors
              SET legal_name = $2, country = $3, address = $4, tax_residency = $5, experience = $6, niche = $7,
                  info_request_note = NULL, submitted_at = now(), updated_at = now(), version = version + 1
            WHERE id = $1`,
          [existing.id, ...values],
        );
        if (taxValues)
          await tx.query(
            `UPDATE identity.advisors SET tax_id_enc = $2, tax_id_last4 = $3 WHERE id = $1`,
            [existing.id, ...taxValues],
          );
        await this.audit.record({
          actorType: 'user',
          action: 'advisor.application_resubmitted',
          entityType: 'advisor',
          entityId: existing.id,
          module: 'identity',
          before: this.applicationFields(existing),
          after: input,
        });
        // Checks already passed stay valid; any missing ones are (re)started.
        if (existing.kyc_status !== 'passed' || existing.agreement_status !== 'signed') {
          await tx.enqueue(
            'identity.start-checks',
            { advisorId: existing.id },
            { jobKey: `start-checks:${existing.id}` },
          );
        }
        await tx.publish({
          type: 'AdvisorApplicationSubmitted',
          version: 1,
          payload: { advisorId: existing.id, userId },
        });
        await this.maybeCompleteChecks(tx, existing.id);
        return existing.id;
      }
      const id = newId();
      await tx.query(
        `INSERT INTO identity.advisors (id, user_id, status, legal_name, country, address, tax_residency, experience,
                                        niche, submitted_at)
         VALUES ($1, $2, 'applied', $3, $4, $5, $6, $7, $8, now())`,
        [id, userId, ...values],
      );
      if (taxValues)
        await tx.query(
          `UPDATE identity.advisors SET tax_id_enc = $2, tax_id_last4 = $3 WHERE id = $1`,
          [id, ...taxValues],
        );
      await this.audit.record({
        actorType: 'user',
        action: 'advisor.application_submitted',
        entityType: 'advisor',
        entityId: id,
        module: 'identity',
        after: { status: 'applied', ...input },
      });
      await tx.enqueue(
        'identity.start-checks',
        { advisorId: id },
        { jobKey: `start-checks:${id}` },
      );
      await tx.publish({
        type: 'AdvisorApplicationSubmitted',
        version: 1,
        payload: { advisorId: id, userId },
      });
      await tx.publish({
        type: 'AdvisorStatusChanged',
        version: 1,
        payload: { advisorId: id, userId, from: null, to: 'applied' },
      });
      return id;
    });
    return this.getApplication(advisorId);
  }

  private applicationFields(r: AdvisorRow) {
    return {
      legalName: r.legal_name,
      country: r.country,
      address: r.address,
      taxResidency: r.tax_residency,
      experience: r.experience,
      niche: r.niche,
    };
  }

  /** Starts KYC and sends the contractor agreement (FR-AUTH-04, FR-AUTH-05). Idempotent per check. */
  async startChecks(advisorId: string): Promise<void> {
    const [a] = await this.db.read<AdvisorRow & { email: string | null }>(
      'identity',
      `SELECT a.*, u.email FROM identity.advisors a JOIN identity.users u ON u.id = a.user_id WHERE a.id = $1`,
      [advisorId],
    );
    if (!a || a.status !== 'applied') return;
    if (a.kyc_status === 'not_started' || a.kyc_status === 'failed') {
      const r = await this.kyc.startVerification({
        advisorId,
        legalName: a.legal_name,
        country: a.country,
      });
      await this.db.transaction('identity', (tx) =>
        tx.query(
          `UPDATE identity.advisors SET kyc_status = 'pending', kyc_provider = $2, kyc_reference = $3,
                  kyc_redirect_url = $4, updated_at = now() WHERE id = $1`,
          [advisorId, this.kyc.provider, r.reference, r.redirectUrl],
        ),
      );
    }
    if (a.agreement_status === 'not_sent' || a.agreement_status === 'declined') {
      const r = await this.esign.createEnvelope({
        advisorId,
        signerName: a.legal_name,
        signerEmail: a.email,
        templateVersion: AGREEMENT_VERSION,
      });
      await this.db.transaction('identity', (tx) =>
        tx.query(
          `UPDATE identity.advisors SET agreement_status = 'sent', agreement_version = $2, agreement_envelope_ref = $3,
                  agreement_signing_url = $4, updated_at = now() WHERE id = $1`,
          [advisorId, AGREEMENT_VERSION, r.envelopeRef, r.signingUrl],
        ),
      );
    }
  }

  async applyKycResult(result: KycResult, tx: Tx): Promise<void> {
    const [a] = await tx.query<AdvisorRow>(
      `UPDATE identity.advisors SET kyc_status = $3, kyc_checked_at = now(), kyc_redirect_url = NULL,
              updated_at = now(), version = version + 1
        WHERE kyc_provider = $1 AND kyc_reference = $2 RETURNING *`,
      [result.provider, result.reference, result.outcome],
    );
    if (!a) throw new Error(`No advisor for KYC reference ${result.reference}`);
    await this.audit.record({
      actorType: 'provider',
      actorId: null,
      action: `advisor.kyc_${result.outcome}`,
      entityType: 'advisor',
      entityId: a.id,
      module: 'identity',
      metadata: { provider: result.provider, reference: result.reference },
    });
    await this.maybeCompleteChecks(tx, a.id);
  }

  async applySignatureResult(result: SignatureResult, tx: Tx): Promise<void> {
    const [a] = await tx.query<AdvisorRow>(
      `UPDATE identity.advisors SET agreement_status = $2, agreement_document_ref = $3, agreement_signed_at = $4,
              agreement_signing_url = NULL, updated_at = now(), version = version + 1
        WHERE agreement_envelope_ref = $1 RETURNING *`,
      [result.envelopeRef, result.outcome, result.documentRef, result.signedAt],
    );
    if (!a) throw new Error(`No advisor for envelope ${result.envelopeRef}`);
    await this.audit.record({
      actorType: 'provider',
      actorId: null,
      action: `advisor.agreement_${result.outcome}`,
      entityType: 'advisor',
      entityId: a.id,
      module: 'identity',
      metadata: {
        envelopeRef: result.envelopeRef,
        documentRef: result.documentRef,
        version: a.agreement_version,
      },
    });
    await this.maybeCompleteChecks(tx, a.id);
  }

  private async maybeCompleteChecks(tx: Tx, advisorId: string): Promise<void> {
    const a = await this.lock(tx, advisorId);
    if (
      a.status === 'applied' &&
      a.kyc_status === 'passed' &&
      a.agreement_status === 'signed' &&
      !a.info_request_note
    ) {
      await this.transition(tx, a, 'checks_completed', {});
    }
  }

  // ---------- Lifecycle ----------

  /** FR-ADM-02: suspend, reinstate or offboard an advisor, with a reason. Callers handle open bookings first. */
  async changeStatus(
    advisorId: string,
    event: 'suspended' | 'reinstated' | 'offboarded',
    reason: string,
  ): Promise<AdvisorSummary> {
    let userId = '';
    await this.db.transaction('identity', async (tx) => {
      const a = await this.lock(tx, advisorId);
      userId = a.user_id;
      if (!advisorLifecycle.can(a.status, event))
        throw problem(
          HttpStatus.CONFLICT,
          'status-not-allowed',
          `An advisor who is ${a.status} cannot be ${event === 'reinstated' ? 'reinstated' : event}`,
        );
      await this.transition(tx, a, event, { status_reason: reason, status_changed_at: new Date() });
    });
    // Suspension and offboarding end every open session now, not at the next request after expiry.
    if (event !== 'reinstated') await this.auth.sessions.destroyAllForUser(userId);
    return (await this.getAdvisor(advisorId))!;
  }

  /** The admin console's advisor list: everyone past the application stage, newest first. */
  async listAdvisors(filter: { status?: AdvisorStatus | undefined; q?: string | undefined }) {
    const rows = await this.db.read<AdvisorRow & { status_reason: string | null }>(
      'identity',
      `SELECT * FROM identity.advisors
        WHERE ($1::text IS NULL OR status = $1)
          AND ($2::text IS NULL OR legal_name ILIKE '%' || $2 || '%')
          AND status NOT IN ('applied', 'under_review', 'rejected')
        ORDER BY coalesce(status_changed_at, approved_at, submitted_at) DESC LIMIT 200`,
      [filter.status ?? null, filter.q ?? null],
    );
    return rows.map((r) => ({ ...this.toSummary(r), statusReason: r.status_reason }));
  }

  private async lock(tx: Tx, advisorId: string): Promise<AdvisorRow> {
    const [a] = await tx.query<AdvisorRow>(
      'SELECT * FROM identity.advisors WHERE id = $1 FOR UPDATE',
      [advisorId],
    );
    if (!a) throw problem(HttpStatus.NOT_FOUND, 'not-found', 'Advisor not found');
    return a;
  }

  /** Applies a lifecycle event: state machine check, update, audit row and events, in the caller's tx. */
  private async transition(
    tx: Tx,
    a: AdvisorRow,
    event: AdvisorEvent,
    sets: Record<string, unknown>,
  ): Promise<AdvisorRow> {
    const to = advisorLifecycle.next(a.status, event);
    const cols = Object.keys(sets);
    const assignments = cols.map((c, i) => `${c} = $${i + 3}`);
    const [updated] = await tx.query<AdvisorRow>(
      `UPDATE identity.advisors SET status = $2, ${[...assignments, 'updated_at = now()', 'version = version + 1'].join(', ')}
        WHERE id = $1 RETURNING *`,
      [a.id, to, ...cols.map((c) => sets[c])],
    );
    await this.audit.record({
      actorType: requestContext.get()?.actorId ? 'user' : 'system',
      action: `advisor.${event}`,
      entityType: 'advisor',
      entityId: a.id,
      module: 'identity',
      before: { status: a.status },
      after: { status: to, ...sets },
    });
    await tx.publish({
      type: 'AdvisorStatusChanged',
      version: 1,
      payload: { advisorId: a.id, userId: a.user_id, from: a.status, to },
    });
    return updated as AdvisorRow;
  }

  /** ADM-01: approve (accept), reject, or request information. */
  async decide(
    advisorId: string,
    decision: ReviewDecision,
    note: string | null,
    actorId: string,
  ): Promise<AdvisorApplicationView> {
    await this.db.transaction('identity', async (tx) => {
      const a = await this.lock(tx, advisorId);
      if (decision === 'accept') {
        if (a.status !== 'under_review') {
          throw problem(
            HttpStatus.CONFLICT,
            'not-reviewable',
            'Only applications under review can be accepted',
            'Identity verification and the signed agreement are both required first.',
          );
        }
        if (a.accepted_at) return; // already accepted; membership payment pending
        await tx.query(
          'UPDATE identity.advisors SET accepted_at = now(), decided_by = $2, updated_at = now(), version = version + 1 WHERE id = $1',
          [a.id, actorId],
        );
        await this.audit.record({
          actorType: 'user',
          actorId,
          action: 'advisor.application_accepted',
          entityType: 'advisor',
          entityId: a.id,
          module: 'identity',
          metadata: { note },
        });
        await tx.publish({
          type: 'AdvisorApplicationAccepted',
          version: 1,
          payload: { advisorId: a.id, userId: a.user_id },
        });
      } else if (decision === 'reject') {
        await this.transition(tx, a, 'rejected', { decided_by: actorId });
        await tx.publish({
          type: 'AdvisorApplicationRejected',
          version: 1,
          payload: { advisorId: a.id, userId: a.user_id },
        });
      } else {
        if (!note)
          throw problem(HttpStatus.BAD_REQUEST, 'note-required', 'Say what information is needed');
        await this.transition(tx, a, 'information_requested', {
          info_request_note: note,
          decided_by: actorId,
        });
        await tx.publish({
          type: 'AdvisorInformationRequested',
          version: 1,
          payload: { advisorId: a.id, userId: a.user_id, note },
        });
      }
    });
    return this.getApplication(advisorId);
  }

  /**
   * Called by Membership when the first membership payment succeeds (AC-01). Requires prior acceptance.
   * Joins the caller's transaction, so the payment record and the approval commit together.
   */
  async approveAfterMembershipPaid(advisorId: string): Promise<void> {
    await this.db.transaction('identity', async (tx) => {
      const a = await this.lock(tx, advisorId);
      if (a.status === 'approved' || a.status === 'active') return;
      if (!a.accepted_at) throw new Error(`Advisor ${advisorId} paid membership before acceptance`);
      await this.transition(tx, a, 'membership_paid', { approved_at: new Date() });
      await tx.publish({
        type: 'AdvisorApproved',
        version: 1,
        payload: { advisorId: a.id, userId: a.user_id },
      });
      if (a.essentials_passed_at) await this.activate(tx, a.id);
    });
  }

  /** Called by Learning when the Essentials course is passed (FR-LRN-02, AC-01). */
  async recordEssentialsPassed(advisorId: string): Promise<void> {
    await this.db.transaction('identity', async (tx) => {
      const a = await this.lock(tx, advisorId);
      if (a.essentials_passed_at) return;
      await tx.query(
        'UPDATE identity.advisors SET essentials_passed_at = now(), updated_at = now() WHERE id = $1',
        [a.id],
      );
      await this.audit.record({
        actorType: 'system',
        action: 'advisor.essentials_passed',
        entityType: 'advisor',
        entityId: a.id,
        module: 'identity',
      });
      if (a.status === 'approved') await this.activate(tx, a.id);
    });
  }

  private async activate(tx: Tx, advisorId: string): Promise<void> {
    const a = await this.lock(tx, advisorId);
    await this.transition(tx, a, 'essentials_passed', { activated_at: new Date() });
    await tx.publish({
      type: 'AdvisorActivated',
      version: 1,
      payload: { advisorId: a.id, userId: a.user_id },
    });
  }

  /** FR-AUTH-07: booking is blocked until status is Active and Essentials is passed. */
  async canBook(advisorId: string): Promise<{ allowed: boolean; reason: string | null }> {
    const [a] = await this.db.read<AdvisorRow>(
      'identity',
      'SELECT * FROM identity.advisors WHERE id = $1',
      [advisorId],
    );
    if (!a) return { allowed: false, reason: 'unknown_advisor' };
    if (a.status !== 'active') return { allowed: false, reason: `status_${a.status}` };
    if (!a.essentials_passed_at) return { allowed: false, reason: 'essentials_not_passed' };
    return { allowed: true, reason: null };
  }

  // ---------- Queries ----------

  /**
   * The advisor behind a signed-in user, if their status is one of `allowed`; otherwise a 403 problem.
   * Used by modules whose features are for members only (CRM, community).
   */
  async requireAdvisor(userId: string, allowed: readonly AdvisorStatus[]): Promise<AdvisorSummary> {
    const a = await this.getAdvisorByUser(userId);
    if (!a)
      throw problem(
        HttpStatus.FORBIDDEN,
        'not-an-advisor',
        'Submit your advisor application first',
      );
    if (!allowed.includes(a.status)) {
      throw problem(
        HttpStatus.FORBIDDEN,
        'advisor-status',
        'Not available for your account yet',
        `Current status: ${a.status}.`,
      );
    }
    return a;
  }

  async getDisplayName(userId: string): Promise<string> {
    const [u] = await this.db.read<{
      display_name: string | null;
      legal_name: string | null;
      role: string;
    }>(
      'identity',
      `SELECT u.display_name, a.legal_name, u.role FROM identity.users u
         LEFT JOIN identity.advisors a ON a.user_id = u.id WHERE u.id = $1`,
      [userId],
    );
    if (!u) return 'Unknown';
    return u.display_name ?? u.legal_name ?? (u.role === 'advisor' ? 'Advisor' : 'Team member');
  }

  async getApplication(advisorId: string): Promise<AdvisorApplicationView> {
    const [a] = await this.db.read<AdvisorRow>(
      'identity',
      'SELECT * FROM identity.advisors WHERE id = $1',
      [advisorId],
    );
    if (!a) throw problem(HttpStatus.NOT_FOUND, 'not-found', 'Application not found');
    return this.toView(a);
  }

  async getApplicationForUser(userId: string): Promise<AdvisorApplicationView | null> {
    const [a] = await this.db.read<AdvisorRow>(
      'identity',
      'SELECT * FROM identity.advisors WHERE user_id = $1',
      [userId],
    );
    return a ? this.toView(a) : null;
  }

  async getAdvisor(advisorId: string): Promise<AdvisorSummary | null> {
    const [a] = await this.db.read<AdvisorRow>(
      'identity',
      'SELECT * FROM identity.advisors WHERE id = $1',
      [advisorId],
    );
    return a ? this.toSummary(a) : null;
  }

  async getAdvisorByUser(userId: string): Promise<AdvisorSummary | null> {
    const [a] = await this.db.read<AdvisorRow>(
      'identity',
      'SELECT * FROM identity.advisors WHERE user_id = $1',
      [userId],
    );
    return a ? this.toSummary(a) : null;
  }

  /** Admin review queue, oldest submission first, cursor-paginated. */
  async listApplications(filter: {
    status?: AdvisorStatus | undefined;
    limit: number;
    cursor?: string | undefined;
  }): Promise<
    Page<AdvisorSummary & { submittedAt: string; kycStatus: string; agreementStatus: string }>
  > {
    const cursor = decodeCursor(filter.cursor);
    const params: unknown[] = [filter.limit + 1];
    const where: string[] = [];
    if (filter.status) {
      params.push(filter.status);
      where.push(`status = $${params.length}`);
    }
    if (cursor) {
      params.push(cursor.sort, cursor.id);
      where.push(
        `(submitted_at, id) > ($${params.length - 1}::timestamptz, $${params.length}::uuid)`,
      );
    }
    const rows = await this.db.read<AdvisorRow>(
      'identity',
      `SELECT * FROM identity.advisors ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
        ORDER BY submitted_at, id LIMIT $1`,
      params,
    );
    return toPage(
      rows.map((r) => ({
        ...this.toSummary(r),
        submittedAt: r.submitted_at.toISOString(),
        kycStatus: r.kyc_status,
        agreementStatus: r.agreement_status,
      })),
      filter.limit,
      (r) => ({ sort: r.submittedAt, id: r.id }),
    );
  }

  private toSummary(a: AdvisorRow): AdvisorSummary {
    return {
      id: a.id,
      userId: a.user_id,
      status: a.status,
      legalName: a.legal_name,
      country: a.country,
      acceptedAt: iso(a.accepted_at),
      approvedAt: iso(a.approved_at),
      essentialsPassedAt: iso(a.essentials_passed_at),
    };
  }

  private toView(a: AdvisorRow): AdvisorApplicationView {
    return {
      ...this.toSummary(a),
      address: a.address,
      taxResidency: a.tax_residency,
      experience: a.experience,
      niche: a.niche,
      taxId: { provided: a.tax_id_last4 !== null, last4: a.tax_id_last4 },
      submittedAt: a.submitted_at.toISOString(),
      infoRequestNote: a.info_request_note,
      kyc: {
        status: a.kyc_status,
        redirectUrl: a.kyc_redirect_url,
        checkedAt: iso(a.kyc_checked_at),
      },
      agreement: {
        status: a.agreement_status,
        version: a.agreement_version,
        signingUrl: a.agreement_signing_url,
        signedAt: iso(a.agreement_signed_at),
        documentRef: a.agreement_document_ref,
      },
    };
  }
}
