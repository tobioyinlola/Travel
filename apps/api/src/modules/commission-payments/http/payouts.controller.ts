import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, Roles, type AuthUser } from '../../../platform/http/auth.js';
import { RequireIdempotencyKey } from '../../../platform/http/idempotency.js';
import { ZBody, ZResponse } from '../../../platform/http/zod.js';
import { IdentityApi } from '../../identity/index.js';
import { PayoutsService } from '../application/payouts.service.js';
import {
  adjustmentResultSchema,
  adjustmentSchema,
  advisorPayoutsSchema,
  holdReleaseSchema,
  holdResultSchema,
  holdSchema,
  payoutAccountSchema,
  payoutRunListSchema,
  payoutRunSchema,
} from './schemas.js';

/** The advisor's payout account and itemised payout statements (FR-COM-07, 08). */
@ApiTags('payouts')
@Controller({ path: 'payouts', version: '1' })
@Roles('advisor')
export class PayoutsController {
  constructor(
    private readonly payouts: PayoutsService,
    private readonly identity: IdentityApi,
  ) {}

  private async advisorId(user: AuthUser) {
    return (await this.identity.requireAdvisor(user.id, ['approved', 'active'])).id;
  }

  @Get()
  @ZResponse(200, advisorPayoutsSchema)
  async mine(@CurrentUser() user: AuthUser) {
    return this.payouts.forAdvisor(await this.advisorId(user));
  }

  /** Where to pay: the provider's token for the advisor's bank account (never bank details). */
  @Put('account')
  @ZResponse(200, advisorPayoutsSchema)
  async setAccount(
    @CurrentUser() user: AuthUser,
    @ZBody(payoutAccountSchema) body: z.infer<typeof payoutAccountSchema>,
  ) {
    return this.payouts.setAccount(await this.advisorId(user), body);
  }
}

/** Finance: payout runs with two approvers, holds and adjustments (FR-COM-07, 09). */
@ApiTags('finance')
@Controller({ path: 'finance', version: '1' })
@Roles('finance', 'admin')
export class FinancePayoutsController {
  constructor(private readonly payouts: PayoutsService) {}

  @Get('payout-runs')
  @ZResponse(200, payoutRunListSchema)
  list() {
    return this.payouts.listRuns();
  }

  @Get('payout-runs/:id')
  @ZResponse(200, payoutRunSchema)
  get(@Param('id', ParseUUIDPipe) id: string) {
    return this.payouts.getRun(id);
  }

  @Post('payout-runs')
  @RequireIdempotencyKey()
  @ZResponse(201, payoutRunSchema)
  create(@CurrentUser() user: AuthUser) {
    return this.payouts.createRun(user.id);
  }

  /** The second, different approver starts the payouts. */
  @Post('payout-runs/:id/approve')
  @HttpCode(HttpStatus.OK)
  @RequireIdempotencyKey()
  @ZResponse(200, payoutRunSchema)
  approve(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payouts.approve(id, user.id);
  }

  @Post('payout-runs/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ZResponse(200, payoutRunSchema)
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.payouts.cancelRun(id, user.id);
  }

  @Post('advisors/:advisorId/hold')
  @HttpCode(HttpStatus.OK)
  @ZResponse(200, holdResultSchema)
  hold(
    @CurrentUser() user: AuthUser,
    @Param('advisorId', ParseUUIDPipe) advisorId: string,
    @ZBody(holdSchema) body: z.infer<typeof holdSchema>,
  ) {
    return this.payouts.placeHold(advisorId, body.reason, user.id);
  }

  @Post('advisors/:advisorId/hold/release')
  @HttpCode(HttpStatus.OK)
  @ZResponse(200, holdResultSchema)
  releaseHold(
    @CurrentUser() user: AuthUser,
    @Param('advisorId', ParseUUIDPipe) advisorId: string,
    @ZBody(holdReleaseSchema) body: z.infer<typeof holdReleaseSchema>,
  ) {
    return this.payouts.releaseHold(advisorId, body.note, user.id);
  }

  @Post('adjustments')
  @RequireIdempotencyKey()
  @ZResponse(201, adjustmentResultSchema)
  adjust(
    @CurrentUser() user: AuthUser,
    @ZBody(adjustmentSchema) body: z.infer<typeof adjustmentSchema>,
  ) {
    return this.payouts.adjust(body, user.id);
  }
}
