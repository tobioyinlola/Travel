import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Sse,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, Roles, type AuthUser } from '../../../platform/http/auth.js';
import { RequireIdempotencyKey } from '../../../platform/http/idempotency.js';
import { ZBody, ZQuery, ZResponse } from '../../../platform/http/zod.js';
import { IdentityApi } from '../../identity/index.js';
import { LiveStatusService } from '../application/live-status.service.js';
import { BookingService } from '../application/booking.service.js';
import {
  bookingListSchema,
  bookingSchema,
  cancelSchema,
  cancellationQuoteSchema,
  modifySchema,
  stuckListSchema,
} from './schemas.js';

const listQuery = z.object({
  tripId: z.uuid().optional(),
  status: z
    .enum([
      'draft',
      'pending',
      'confirmed',
      'failed',
      'modified',
      'cancelled',
      'completed',
      'reversed',
    ])
    .optional(),
});
const stuckQuery = z.object({ minutes: z.coerce.number().int().min(1).max(1440).optional() });

/** Bookings of the signed-in advisor (FR-BKG-05). */
@ApiTags('bookings')
@Controller({ path: 'bookings', version: '1' })
@Roles('advisor')
export class BookingsController {
  constructor(
    private readonly booking: BookingService,
    private readonly live: LiveStatusService,
    private readonly identity: IdentityApi,
  ) {}

  private async advisorId(user: AuthUser) {
    return (await this.identity.requireAdvisor(user.id, ['approved', 'active'])).id;
  }

  /** Server-Sent Events: a `booking` message whenever one of the advisor's bookings changes. */
  @Sse('stream')
  async stream(@CurrentUser() user: AuthUser) {
    return this.live.stream(await this.advisorId(user));
  }

  @Get()
  @ZResponse(200, bookingListSchema)
  async list(@CurrentUser() user: AuthUser, @ZQuery(listQuery) q: z.infer<typeof listQuery>) {
    return this.booking.list(await this.advisorId(user), q);
  }

  @Get(':id')
  @ZResponse(200, bookingSchema)
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.booking.get(await this.advisorId(user), id);
  }

  /** The penalty is shown before anything is cancelled. */
  @Get(':id/cancellation-quote')
  @ZResponse(200, cancellationQuoteSchema)
  async quote(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.booking.cancellationQuote(await this.advisorId(user), id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequireIdempotencyKey()
  @ZResponse(200, bookingSchema)
  async cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(cancelSchema) body: z.infer<typeof cancelSchema>,
  ) {
    return this.booking.cancel(await this.advisorId(user), id, body.reason);
  }

  /** Change the lead guest or special requests on a confirmed booking; hotels are told in the background. */
  @Patch(':id/guest')
  @RequireIdempotencyKey()
  @ZResponse(200, bookingSchema)
  async modify(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(modifySchema) body: z.infer<typeof modifySchema>,
  ) {
    return this.booking.modifyGuest(await this.advisorId(user), id, body);
  }

  /** Drop a booking the traveler has not submitted, so the trip can be changed and proposed again. */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async discard(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.booking.discardDraft(await this.advisorId(user), id);
  }
}

/** Support queue for bookings stuck waiting on suppliers (FRD: "stuck Pending alert + support queue"). */
@ApiTags('support')
@Controller({ path: 'support/bookings', version: '1' })
@Roles('support', 'admin')
export class SupportBookingsController {
  constructor(private readonly booking: BookingService) {}

  @Get('stuck')
  @ZResponse(200, stuckListSchema)
  stuck(@ZQuery(stuckQuery) q: z.infer<typeof stuckQuery>) {
    return this.booking.stuck(q.minutes);
  }

  @Post(':id/retry')
  @HttpCode(HttpStatus.NO_CONTENT)
  async retry(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.booking.retryStuck(id, user.id);
  }
}
