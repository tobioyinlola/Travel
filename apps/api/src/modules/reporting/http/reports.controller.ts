import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, Roles, type AuthUser } from '../../../platform/http/auth.js';
import { ZQuery, ZResponse } from '../../../platform/http/zod.js';
import { IdentityApi } from '../../identity/index.js';
import { periodOf, ReportsService } from '../application/reports.service.js';
import {
  advisorReportSchema,
  financeReportSchema,
  periodQuery,
  platformReportSchema,
} from './schemas.js';

/** The advisor's own dashboard numbers (FR-RPT-01). */
@ApiTags('reports')
@Controller({ path: 'reports', version: '1' })
export class ReportsController {
  constructor(
    private readonly reports: ReportsService,
    private readonly identity: IdentityApi,
  ) {}

  @Get('advisor')
  @Roles('advisor')
  @ZResponse(200, advisorReportSchema)
  async advisor(
    @CurrentUser() user: AuthUser,
    @ZQuery(periodQuery) q: z.infer<typeof periodQuery>,
  ) {
    const a = await this.identity.requireAdvisor(user.id, ['approved', 'active']);
    return this.reports.advisor(a.id, periodOf(q.from, q.to));
  }

  /** Finance report (FR-RPT-02). */
  @Get('finance')
  @Roles('finance', 'admin')
  @ZResponse(200, financeReportSchema)
  finance(@ZQuery(periodQuery) q: z.infer<typeof periodQuery>) {
    return this.reports.finance(periodOf(q.from, q.to));
  }

  /** Platform health: activation, time to first booking, active advisors, bookings by supplier (FR-RPT-03). */
  @Get('platform')
  @Roles('admin')
  @ZResponse(200, platformReportSchema)
  platform(@ZQuery(periodQuery) q: z.infer<typeof periodQuery>) {
    return this.reports.platform(periodOf(q.from, q.to));
  }
}
