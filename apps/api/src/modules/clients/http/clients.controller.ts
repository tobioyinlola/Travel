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
import { ClientsService } from '../application/clients.service.js';
import {
  clientCreateSchema,
  clientListQuery,
  clientSchema,
  clientSummarySchema,
  clientUpdateSchema,
  companionSchema,
  privacyRequestSchema,
} from './schemas.js';

/** The signed-in advisor's own clients (FR-CRM-01..03, 07, 08). Other advisors' clients do not exist here. */
@ApiTags('clients')
@Controller({ path: 'clients', version: '1' })
@Roles('advisor')
export class ClientsController {
  constructor(private readonly clients: ClientsService) {}

  private async advisorId(user: AuthUser): Promise<string> {
    return (await this.clients.advisorFor(user.id)).id;
  }

  @Get()
  @ZResponse(
    200,
    z.object({ items: z.array(clientSummarySchema), nextCursor: z.string().nullable() }),
  )
  async list(
    @CurrentUser() user: AuthUser,
    @ZQuery(clientListQuery) q: z.infer<typeof clientListQuery>,
  ) {
    return this.clients.list(await this.advisorId(user), q);
  }

  @Post()
  @ZResponse(201, clientSchema)
  async create(
    @CurrentUser() user: AuthUser,
    @ZBody(clientCreateSchema) body: z.infer<typeof clientCreateSchema>,
  ) {
    return this.clients.create(await this.advisorId(user), body);
  }

  @Get(':id')
  @ZResponse(200, clientSchema)
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.clients.get(await this.advisorId(user), id);
  }

  @Patch(':id')
  @ZResponse(200, clientSchema)
  async update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(clientUpdateSchema) body: z.infer<typeof clientUpdateSchema>,
  ) {
    const { version, ...patch } = body;
    return this.clients.update(await this.advisorId(user), id, version, patch);
  }

  @Post(':id/archive')
  @HttpCode(HttpStatus.OK)
  @ZResponse(200, clientSchema)
  async archive(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.clients.setArchived(await this.advisorId(user), id, true);
  }

  @Post(':id/restore')
  @HttpCode(HttpStatus.OK)
  @ZResponse(200, clientSchema)
  async restore(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.clients.setArchived(await this.advisorId(user), id, false);
  }

  @Post(':id/companions')
  @ZResponse(201, clientSchema)
  async addCompanion(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(companionSchema) body: z.infer<typeof companionSchema>,
  ) {
    return this.clients.addCompanion(await this.advisorId(user), id, body);
  }

  @Delete(':id/companions/:companionId')
  @ZResponse(200, clientSchema)
  async removeCompanion(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('companionId', ParseUUIDPipe) companionId: string,
  ) {
    return this.clients.removeCompanion(await this.advisorId(user), id, companionId);
  }

  @Post(':id/privacy-requests')
  @ZResponse(201, z.object({ id: z.uuid() }))
  async privacy(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(privacyRequestSchema) body: z.infer<typeof privacyRequestSchema>,
  ) {
    return this.clients.requestPrivacy(
      await this.advisorId(user),
      user.id,
      id,
      body.kind,
      body.note,
    );
  }
}
