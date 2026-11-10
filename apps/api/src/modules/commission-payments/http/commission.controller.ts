import { Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, Roles, type AuthUser } from '../../../platform/http/auth.js';
import { RequireIdempotencyKey } from '../../../platform/http/idempotency.js';
import { ZBody, ZQuery, ZResponse } from '../../../platform/http/zod.js';
import { IdentityApi } from '../../identity/index.js';
import { MembershipApi } from '../../membership/index.js';
import { CommissionService } from '../application/commission.service.js';
import { StatementsService } from '../application/statements.service.js';
import {
  earningsSchema,
  importResultSchema,
  lineResultSchema,
  reconciliationSchema,
  resolveSchema,
  statementImportSchema,
  statementLinesSchema,
  statementListSchema,
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
const lineQuery = z.object({
  status: z.enum(['matched', 'mismatch', 'unmatched', 'resolved', 'rejected']).optional(),
});
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
  constructor(
    private readonly commissions: CommissionService,
    private readonly statements: StatementsService,
  ) {}

  @Get('commissions')
  @ZResponse(200, financeListSchema)
  list(@ZQuery(financeQuery) q: z.infer<typeof financeQuery>) {
    return this.commissions.forFinance(q);
  }

  /** Import a supplier's commission statement; exact matches settle, the rest wait for a person. */
  @Post('statements')
  @RequireIdempotencyKey()
  @ZResponse(201, importResultSchema)
  importStatement(
    @CurrentUser() user: AuthUser,
    @ZBody(statementImportSchema) body: z.infer<typeof statementImportSchema>,
  ) {
    return this.statements.import(user.id, body);
  }

  @Get('statements')
  @ZResponse(200, statementListSchema)
  listStatements() {
    return this.statements.statements();
  }

  @Get('statement-lines')
  @ZResponse(200, statementLinesSchema)
  lines(@ZQuery(lineQuery) q: z.infer<typeof lineQuery>) {
    return this.statements.lines(q);
  }

  /** Decide a line whose amount differs from what was expected. */
  @Post('statement-lines/:id/resolve')
  @HttpCode(HttpStatus.OK)
  @RequireIdempotencyKey()
  @ZResponse(200, lineResultSchema)
  resolve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(resolveSchema) body: z.infer<typeof resolveSchema>,
  ) {
    return this.statements.resolve(id, user.id, body.decision, body.note);
  }

  @Get('reconciliation')
  @ZResponse(200, reconciliationSchema)
  reconciliation() {
    return this.statements.reconciliation();
  }

  @Get('ledger/trial-balance')
  @ZResponse(200, trialBalanceSchema)
  trialBalance() {
    return this.commissions.trialBalance();
  }
}
