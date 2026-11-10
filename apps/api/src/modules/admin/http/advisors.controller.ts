import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, Roles, type AuthUser } from '../../../platform/http/auth.js';
import { RequireIdempotencyKey } from '../../../platform/http/idempotency.js';
import { ZBody, ZQuery, ZResponse } from '../../../platform/http/zod.js';
import { ADVISOR_STATUSES } from '../../identity/index.js';
import { AdvisorLifecycleService } from '../application/advisor-lifecycle.service.js';

const advisorSchema = z.object({
  id: z.uuid(),
  userId: z.uuid(),
  status: z.enum(ADVISOR_STATUSES),
  legalName: z.string(),
  country: z.string(),
  acceptedAt: z.string().nullable(),
  approvedAt: z.string().nullable(),
  essentialsPassedAt: z.string().nullable(),
  statusReason: z.string().nullable().optional(),
});
const listSchema = z.object({ items: z.array(advisorSchema) });
const listQuery = z.object({
  status: z.enum(ADVISOR_STATUSES).optional(),
  q: z.string().trim().max(100).optional(),
});
const reasonSchema = z.object({ reason: z.string().trim().min(3).max(500) });
const offboardSchema = reasonSchema.extend({ reassignToAdvisorId: z.uuid().optional() });
const offboardResultSchema = z.object({
  advisor: advisorSchema,
  reassignedBookings: z.number().int(),
});

/** Advisor lifecycle for admins (FR-ADM-02). */
@ApiTags('admin')
@Controller({ path: 'admin/advisors', version: '1' })
@Roles('admin')
export class AdvisorsAdminController {
  constructor(private readonly lifecycle: AdvisorLifecycleService) {}

  @Get()
  @ZResponse(200, listSchema)
  async list(@ZQuery(listQuery) q: z.infer<typeof listQuery>) {
    return { items: await this.lifecycle.list(q) };
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @RequireIdempotencyKey()
  @ZResponse(200, advisorSchema)
  suspend(
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(reasonSchema) body: z.infer<typeof reasonSchema>,
  ) {
    return this.lifecycle.suspend(id, body.reason);
  }

  @Post(':id/reinstate')
  @HttpCode(HttpStatus.OK)
  @RequireIdempotencyKey()
  @ZResponse(200, advisorSchema)
  reinstate(
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(reasonSchema) body: z.infer<typeof reasonSchema>,
  ) {
    return this.lifecycle.reinstate(id, body.reason);
  }

  /** Offboard. If they have open bookings, name an active advisor to take them over. */
  @Post(':id/offboard')
  @HttpCode(HttpStatus.OK)
  @RequireIdempotencyKey()
  @ZResponse(200, offboardResultSchema)
  offboard(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(offboardSchema) body: z.infer<typeof offboardSchema>,
  ) {
    return this.lifecycle.offboard(id, body.reason, user.id, body.reassignToAdvisorId);
  }
}
