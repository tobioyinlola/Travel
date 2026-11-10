import { Controller, Get, HttpCode, HttpStatus, Post, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, Public, Roles, type AuthUser } from '../../../platform/http/auth.js';
import { RequireIdempotencyKey } from '../../../platform/http/idempotency.js';
import { ProblemException, problemType } from '../../../platform/http/problem.js';
import { ZBody, ZQuery, ZResponse } from '../../../platform/http/zod.js';
import { MembershipService } from '../application/membership.service.js';
import {
  checkoutSchema,
  membershipViewSchema,
  paymentMethodSchema,
  planSchema,
  quoteQuerySchema,
  quoteSchema,
} from './schemas.js';

@ApiTags('membership')
@Controller({ path: 'membership', version: '1' })
@Roles('advisor')
export class MembershipController {
  constructor(private readonly membership: MembershipService) {}

  @Get('plans')
  @Public()
  @ZResponse(200, z.array(planSchema))
  plans() {
    return this.membership.listPlans();
  }

  /** Signed-in advisors only: a public quote would let anyone probe which promo codes exist. */
  @Get('quote')
  @ZResponse(200, quoteSchema)
  quote(@ZQuery(quoteQuerySchema) q: z.infer<typeof quoteQuerySchema>) {
    return this.membership.quoteFor(q.planCode, q.promoCode);
  }

  @Get()
  @ZResponse(200, membershipViewSchema)
  async get(@CurrentUser() user: AuthUser) {
    const m = await this.membership.getForUser(user.id);
    if (!m)
      throw new ProblemException(
        HttpStatus.NOT_FOUND,
        problemType('not-found'),
        'No membership yet',
      );
    return m;
  }

  @Post('checkout')
  @HttpCode(HttpStatus.OK)
  @RequireIdempotencyKey()
  @ZResponse(200, membershipViewSchema)
  checkout(
    @CurrentUser() user: AuthUser,
    @ZBody(checkoutSchema) body: z.infer<typeof checkoutSchema>,
  ) {
    return this.membership.checkout(user.id, body);
  }

  @Put('payment-method')
  @RequireIdempotencyKey()
  @ZResponse(200, membershipViewSchema)
  updatePaymentMethod(
    @CurrentUser() user: AuthUser,
    @ZBody(paymentMethodSchema) body: z.infer<typeof paymentMethodSchema>,
  ) {
    return this.membership.updatePaymentMethod(user.id, body.paymentMethodRef);
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  @ZResponse(200, membershipViewSchema)
  cancel(@CurrentUser() user: AuthUser) {
    return this.membership.cancel(user.id);
  }
}
