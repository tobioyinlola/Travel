import { Controller, Get, Param, ParseUUIDPipe } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, Roles, type AuthUser } from '../../../platform/http/auth.js';
import { ZResponse } from '../../../platform/http/zod.js';
import { IdentityApi } from '../../identity/index.js';
import { BookingPerksService } from '../application/booking-perks.service.js';

const perksSchema = z.object({
  items: z.array(
    z.object({
      lineId: z.uuid(),
      programName: z.string(),
      tier: z.string(),
      perks: z.array(z.object({ kind: z.string(), description: z.string() })),
    }),
  ),
});

@ApiTags('partners')
@Controller({ path: 'partners/booking-perks', version: '1' })
@Roles('advisor')
export class BookingPerksController {
  constructor(
    private readonly perks: BookingPerksService,
    private readonly identity: IdentityApi,
  ) {}

  /** Partner perks attached to a confirmed booking of the signed-in advisor. */
  @Get(':bookingId')
  @ZResponse(200, perksSchema)
  async forBooking(
    @CurrentUser() user: AuthUser,
    @Param('bookingId', ParseUUIDPipe) bookingId: string,
  ) {
    const advisor = await this.identity.requireAdvisor(user.id, ['approved', 'active']);
    return this.perks.forBooking(advisor.id, bookingId);
  }
}
