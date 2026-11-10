import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditLog } from '../../audit/index.js';
import { CatalogApi, propertySchema } from '../../catalog/index.js';
import { ClientsApi, privacyRequestRowSchema } from '../../clients/index.js';
import { PERK_KINDS, PartnersApi } from '../../partners/index.js';
import { ADVISOR_STATUSES, IdentityApi } from '../../identity/index.js';
import { MembershipApi, membershipViewSchema, promoCreateSchema } from '../../membership/index.js';
import { CurrentUser, Roles, type AuthUser } from '../../../platform/http/auth.js';
import { pageQuerySchema } from '../../../platform/http/pagination.js';
import { ZBody, ZQuery, ZResponse } from '../../../platform/http/zod.js';

const propertyQuery = z.object({ q: z.string().trim().min(2).max(100) });
const supplierSchema = z.object({
  name: z.string().trim().min(2).max(120),
  type: z.enum(['hotel', 'hotel_group', 'cruise_line', 'tour_operator']),
  commissionTerms: z.string().max(2000).optional(),
  payoutTerms: z.string().max(2000).optional(),
});
const programSchema = z.object({
  supplierId: z.uuid(),
  name: z.string().trim().min(2).max(120),
  tier: z.enum(['preferred', 'luxury', 'exclusive']),
  description: z.string().max(2000).optional(),
  perks: z
    .array(z.object({ kind: z.enum(PERK_KINDS), description: z.string().trim().min(2).max(200) }))
    .max(10),
  rateCodes: z
    .array(z.string().regex(/^[A-Z0-9_-]{2,20}$/))
    .max(20)
    .optional(),
  propertyIds: z.array(z.uuid()).max(500),
  active: z.boolean().optional(),
  validFrom: z.iso.date().nullable().optional(),
  validTo: z.iso.date().nullable().optional(),
});
const programViewSchema = z.object({
  id: z.uuid(),
  supplierId: z.uuid(),
  supplierName: z.string(),
  name: z.string(),
  tier: z.enum(['preferred', 'luxury', 'exclusive']),
  description: z.string(),
  perks: z.array(z.object({ kind: z.string(), description: z.string() })),
  rateCodes: z.array(z.string()),
  propertyIds: z.array(z.uuid()),
  active: z.boolean(),
  effective: z.boolean(),
  validFrom: z.string().nullable(),
  validTo: z.string().nullable(),
  version: z.number(),
});
const programPatchSchema = programSchema
  .omit({ supplierId: true })
  .partial()
  .extend({ version: z.number().int().positive() });
const privacyQuery = z.object({
  status: z.enum(['requested', 'verified', 'completed', 'rejected']).optional(),
});
const privacyDecision = z.object({ note: z.string().trim().min(3).max(2000) });
const listQuery = pageQuerySchema.extend({ status: z.enum(ADVISOR_STATUSES).optional() });
const decisionSchema = z.object({
  decision: z.enum(['accept', 'reject', 'request_info']),
  note: z.string().trim().max(2000).optional(),
});

const applicationRow = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  status: z.enum(ADVISOR_STATUSES),
  legalName: z.string(),
  country: z.string(),
  submittedAt: z.string(),
  kycStatus: z.string(),
  agreementStatus: z.string(),
  acceptedAt: z.string().nullable(),
  approvedAt: z.string().nullable(),
  essentialsPassedAt: z.string().nullable(),
});
const auditEntry = z.object({
  id: z.uuid(),
  occurredAt: z.string(),
  actorId: z.string().nullable(),
  actorType: z.string(),
  action: z.string(),
  before: z.unknown(),
  after: z.unknown(),
  metadata: z.unknown(),
});

/** Back office: application review (FR-ADM-01) and promo codes (FR-MEM-04). Admin role, MFA required. */
@ApiTags('admin')
@Controller({ path: 'admin', version: '1' })
@Roles('admin')
export class AdminController {
  constructor(
    private readonly identity: IdentityApi,
    private readonly membership: MembershipApi,
    private readonly audit: AuditLog,
    private readonly clients: ClientsApi,
    private readonly catalog: CatalogApi,
    private readonly partners: PartnersApi,
  ) {}

  @Get('applications')
  @ZResponse(200, z.object({ items: z.array(applicationRow), nextCursor: z.string().nullable() }))
  list(@ZQuery(listQuery) q: z.infer<typeof listQuery>) {
    return this.identity.listApplications(q);
  }

  @Get('applications/:id')
  @ZResponse(
    200,
    z.object({
      application: z.unknown(),
      membership: membershipViewSchema.nullable(),
      history: z.array(auditEntry),
    }),
  )
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    const [application, membership, history] = await Promise.all([
      this.identity.getApplication(id),
      this.membership.getForAdvisor(id),
      this.audit.forEntity('advisor', id),
    ]);
    return {
      application,
      membership,
      history: history.map((h) => ({ ...h, occurredAt: h.occurredAt.toISOString() })),
    };
  }

  @Post('applications/:id/decision')
  @HttpCode(HttpStatus.OK)
  decide(
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(decisionSchema) body: z.infer<typeof decisionSchema>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.identity.decideApplication(id, body.decision, body.note ?? null, user.id);
  }

  // ---------- Privacy requests (FR-CRM-08). Support verifies the requester; admins can too. ----------

  @Get('privacy-requests')
  @Roles('support', 'admin')
  @ZResponse(200, z.array(privacyRequestRowSchema))
  privacyRequests(@ZQuery(privacyQuery) q: z.infer<typeof privacyQuery>) {
    return this.clients.listPrivacyRequests(q.status);
  }

  @Post('privacy-requests/:id/verify')
  @Roles('support', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  async verifyPrivacy(
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(privacyDecision) body: z.infer<typeof privacyDecision>,
    @CurrentUser() user: AuthUser,
  ) {
    await this.clients.verifyPrivacyRequest(user.id, id, body.note);
  }

  @Post('privacy-requests/:id/reject')
  @Roles('support', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  async rejectPrivacy(
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(privacyDecision) body: z.infer<typeof privacyDecision>,
    @CurrentUser() user: AuthUser,
  ) {
    await this.clients.rejectPrivacyRequest(user.id, id, body.note);
  }

  @Get('privacy-requests/:id/export')
  @Roles('support', 'admin')
  privacyExport(@Param('id', ParseUUIDPipe) id: string) {
    return this.clients.privacyExport(id);
  }

  // ---------- Catalog and partner programs (FR-INV-01, FR-PRT-01) ----------

  @Post('catalog/ingest')
  @HttpCode(HttpStatus.ACCEPTED)
  @ZResponse(202, z.object({ suppliers: z.array(z.string()) }))
  async ingest() {
    return { suppliers: await this.catalog.ingestAll() };
  }

  @Get('catalog/properties')
  @ZResponse(200, z.array(propertySchema.extend({ suppliers: z.array(z.string()) })))
  findProperties(@ZQuery(propertyQuery) q: z.infer<typeof propertyQuery>) {
    return this.catalog.findProperties(q.q);
  }

  @Get('partners/suppliers')
  @ZResponse(
    200,
    z.array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        type: z.string(),
        commissionTerms: z.string(),
        payoutTerms: z.string(),
      }),
    ),
  )
  suppliers() {
    return this.partners.listSuppliers();
  }

  @Post('partners/suppliers')
  @ZResponse(201, z.object({ id: z.uuid() }))
  createSupplier(
    @ZBody(supplierSchema) body: z.infer<typeof supplierSchema>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.partners.createSupplier(user.id, body);
  }

  @Get('partners/programs')
  @ZResponse(200, z.array(programViewSchema))
  programs() {
    return this.partners.listPrograms();
  }

  @Post('partners/programs')
  @ZResponse(201, programViewSchema)
  createProgram(
    @ZBody(programSchema) body: z.infer<typeof programSchema>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.partners.createProgram(user.id, { ...body, rateCodes: body.rateCodes ?? [] });
  }

  @Patch('partners/programs/:id')
  @ZResponse(200, programViewSchema)
  updateProgram(
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(programPatchSchema) body: z.infer<typeof programPatchSchema>,
    @CurrentUser() user: AuthUser,
  ) {
    const { version, ...patch } = body;
    return this.partners.updateProgram(user.id, id, version, patch);
  }

  @Post('promo-codes')
  @ZResponse(201, z.object({ code: z.string() }))
  createPromo(
    @ZBody(promoCreateSchema) body: z.infer<typeof promoCreateSchema>,
    @CurrentUser() user: AuthUser,
  ) {
    return this.membership.createPromoCode(body, user.id);
  }
}
