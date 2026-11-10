import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, Roles, type AuthUser } from '../../../platform/http/auth.js';
import { RequireIdempotencyKey } from '../../../platform/http/idempotency.js';
import { ZQuery, ZResponse } from '../../../platform/http/zod.js';
import { IdentityApi } from '../../identity/index.js';
import { MembershipApi } from '../../membership/index.js';
import { CommissionService } from '../application/commission.service.js';
import {
  commissionSchema,
  earningsSchema,
  financeListSchema,
  tierProgressSchema,
  trialBalanceSchema,
} from './schemas.js';

const STATUSES = [
  'expected',
  'invoiced',
  'received',
  'reconciled',
  'payable',
  'paid',
  'reversed',
] as const;
const statusQuery = z.object({ status: z.enum(STATUSES).optional() });
const financeQuery = statusQuery.extend({ advisorId: z.uuid().optional() });

/** The signed-in advisor's earnings (FR-COM-08) and split tier (FR-MEM-05). */
@ApiTags('commissions')
@Controller({ path: 'commissions', version: '1' })
@Roles('advisor')
export class CommissionsController {
  constructor(
    private readonly commissions: CommissionService,
    private readonly membership: MembershipApi,
    private readonly identity: IdentityApi,
  ) {}

  private async advisorId(user: AuthUser) {
    return (await this.identity.requireAdvisor(user.id, ['approved', 'active'])).id;
  }

  @Get()
  @ZResponse(200, earningsSchema)
  async list(@CurrentUser() user: AuthUser, @ZQuery(statusQuery) q: z.infer<typeof statusQuery>) {
    return this.commissions.forAdvisor(await this.advisorId(user), q);
  }

  @Get('tier')
  @ZResponse(200, tierProgressSchema)
  async tier(@CurrentUser() user: AuthUser) {
    return this.membership.tierProgress(await this.advisorId(user));
  }
}

/** Finance tools (FR-ADM-05, first part): see every commission, record supplier payments, check the ledger. */
@ApiTags('finance')
@Controller({ path: 'finance', version: '1' })
@Roles('finance', 'admin')
export class FinanceController {
  constructor(private readonly commissions: CommissionService) {}

  @Get('commissions')
  @ZResponse(200, financeListSchema)
  list(@ZQuery(financeQuery) q: z.infer<typeof financeQuery>) {
    return this.commissions.forFinance(q);
  }

  /** Record that the supplier paid this commission; the advisor's share becomes payable. */
  @Post('commissions/:id/release')
  @HttpCode(HttpStatus.OK)
  @RequireIdempotencyKey()
  @ZResponse(200, commissionSchema)
  release(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.commissions.release(id, user.id);
  }

  @Get('ledger/trial-balance')
  @ZResponse(200, trialBalanceSchema)
  trialBalance() {
    return this.commissions.trialBalance();
  }
}
