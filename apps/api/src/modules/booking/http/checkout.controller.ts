import { Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { Public } from '../../../platform/http/auth.js';
import { RequireIdempotencyKey } from '../../../platform/http/idempotency.js';
import { ProblemException, problemType } from '../../../platform/http/problem.js';
import { ZBody, ZResponse } from '../../../platform/http/zod.js';
import { BookingService } from '../application/booking.service.js';
import { checkoutSchema, confirmSchema } from './schemas.js';

/** The traveler's checkout, reached with the proposal link token (FR-BKG-02/03, FR-TRV-03). No account. */
@ApiTags('checkout')
@Controller({ path: 'checkout', version: '1' })
@Public()
export class CheckoutController {
  constructor(private readonly booking: BookingService) {}

  @Get(':token')
  @ZResponse(200, checkoutSchema)
  async view(@Param('token') token: string, @Req() req: Request) {
    await this.booking.rateLimit(req.ip ?? 'unknown');
    return this.booking.view(token);
  }

  /** Details and payment choice in one step. The Idempotency-Key makes a double click harmless (AC-04). */
  @Post(':token/confirm')
  @HttpCode(HttpStatus.OK)
  @RequireIdempotencyKey()
  @ZResponse(200, checkoutSchema)
  async confirm(
    @Param('token') token: string,
    @ZBody(confirmSchema) body: z.infer<typeof confirmSchema>,
    @Req() req: Request,
  ) {
    await this.booking.rateLimit(req.ip ?? 'unknown');
    const key = req.header('idempotency-key');
    if (!key)
      throw new ProblemException(
        HttpStatus.BAD_REQUEST,
        problemType('idempotency-key-required'),
        'Idempotency-Key header is required for this operation',
      );
    return this.booking.confirm(token, body, key);
  }
}
