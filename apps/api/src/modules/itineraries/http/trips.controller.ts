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
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, Roles, type AuthUser } from '../../../platform/http/auth.js';
import { ZBody, ZQuery, ZResponse } from '../../../platform/http/zod.js';
import { TripsService } from '../application/trips.service.js';
import {
  addHotelSchema,
  itemCreateSchema,
  itemUpdateSchema,
  publishResultSchema,
  publishSchema,
  tripCreateSchema,
  tripListSchema,
  tripSchema,
  tripSummarySchema,
  tripUpdateSchema,
} from './schemas.js';

const listQuery = z.object({
  status: z.enum(['planning', 'proposed', 'approved', 'booked', 'cancelled']).optional(),
  clientId: z.uuid().optional(),
});

/** Trip and itinerary builder for the signed-in advisor (FR-ITN-01..05). */
@ApiTags('trips')
@Controller({ path: 'trips', version: '1' })
@Roles('advisor')
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  private async advisorId(user: AuthUser) {
    return (await this.trips.planner(user.id)).id;
  }

  @Get()
  @ZResponse(200, tripListSchema)
  async list(@CurrentUser() user: AuthUser, @ZQuery(listQuery) q: z.infer<typeof listQuery>) {
    return this.trips.list(await this.advisorId(user), q);
  }

  @Get('summary')
  @ZResponse(200, tripSummarySchema)
  async summary(@CurrentUser() user: AuthUser) {
    return this.trips.summary(await this.advisorId(user));
  }

  @Post()
  @ZResponse(201, tripSchema)
  async create(
    @CurrentUser() user: AuthUser,
    @ZBody(tripCreateSchema) body: z.infer<typeof tripCreateSchema>,
  ) {
    return this.trips.create(await this.advisorId(user), body);
  }

  @Get(':id')
  @ZResponse(200, tripSchema)
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.trips.get(await this.advisorId(user), id);
  }

  @Patch(':id')
  @ZResponse(200, tripSchema)
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(tripUpdateSchema) body: z.infer<typeof tripUpdateSchema>,
  ) {
    const { version, ...patch } = body;
    return this.trips.update(await this.advisorId(user), id, version, patch);
  }

  @Post(':id/items')
  @ZResponse(201, tripSchema)
  async addItem(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(itemCreateSchema) body: z.infer<typeof itemCreateSchema>,
  ) {
    return this.trips.addItem(await this.advisorId(user), id, body);
  }

  @Post(':id/hotels')
  @ZResponse(201, tripSchema)
  async addHotel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(addHotelSchema) body: z.infer<typeof addHotelSchema>,
  ) {
    return this.trips.addHotel(await this.advisorId(user), id, body.rateKey);
  }

  @Patch(':id/items/:itemId')
  @ZResponse(200, tripSchema)
  async updateItem(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
    @ZBody(itemUpdateSchema) body: z.infer<typeof itemUpdateSchema>,
  ) {
    return this.trips.updateItem(await this.advisorId(user), id, itemId, body);
  }

  @Delete(':id/items/:itemId')
  @ZResponse(200, tripSchema)
  async removeItem(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('itemId', ParseUUIDPipe) itemId: string,
  ) {
    return this.trips.removeItem(await this.advisorId(user), id, itemId);
  }

  @Post(':id/proposals')
  @ZResponse(201, publishResultSchema)
  async publish(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(publishSchema) body: z.infer<typeof publishSchema>,
  ) {
    return this.trips.publish(await this.trips.planner(user.id), id, body);
  }

  @Post(':id/proposals/refresh')
  @HttpCode(HttpStatus.OK)
  @ZResponse(200, publishResultSchema)
  async refresh(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.trips.refreshPrices(await this.trips.planner(user.id), id);
  }
}
