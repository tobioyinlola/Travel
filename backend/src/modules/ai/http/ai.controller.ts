import {
  Controller,
  Delete,
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
import { ZBody, ZResponse } from '../../../platform/http/zod.js';
import { Database } from '../../../platform/db/database.js';
import { IdentityApi } from '../../identity/index.js';
import { AssistantService } from '../application/assistant.service.js';
import { IndexerService } from '../application/indexer.service.js';
import {
  answerSchema,
  askSchema,
  draftApproveSchema,
  draftCreateSchema,
  draftListSchema,
  draftSchema,
  historySchema,
  reindexResultSchema,
  settingsSchema,
} from './schemas.js';

/** The advisor's AI assistant. Members only (Active advisors). It never contacts travelers (FR-AI-03). */
@ApiTags('ai')
@Controller({ path: 'ai', version: '1' })
@Roles('advisor')
export class AiController {
  constructor(
    private readonly assistant: AssistantService,
    private readonly identity: IdentityApi,
  ) {}

  private async advisorId(user: AuthUser) {
    return (await this.identity.requireAdvisor(user.id, ['active'])).id;
  }

  @Post('ask')
  @HttpCode(HttpStatus.OK)
  @ZResponse(200, answerSchema)
  async ask(@CurrentUser() user: AuthUser, @ZBody(askSchema) body: z.infer<typeof askSchema>) {
    return this.assistant.ask(await this.advisorId(user), body);
  }

  @Post('drafts')
  @ZResponse(201, draftSchema)
  async draft(
    @CurrentUser() user: AuthUser,
    @ZBody(draftCreateSchema) body: z.infer<typeof draftCreateSchema>,
  ) {
    return this.assistant.createDraft(await this.advisorId(user), body);
  }

  @Get('drafts')
  @ZResponse(200, draftListSchema)
  async drafts(@CurrentUser() user: AuthUser) {
    return this.assistant.listDrafts(await this.advisorId(user));
  }

  /** Approve (optionally with edits). This records the advisor's decision; nothing is sent. */
  @Post('drafts/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ZResponse(200, draftSchema)
  async approve(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(draftApproveSchema) body: z.infer<typeof draftApproveSchema>,
  ) {
    return this.assistant.decide(await this.advisorId(user), id, 'approved', body.text);
  }

  @Post('drafts/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ZResponse(200, draftSchema)
  async reject(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.assistant.decide(await this.advisorId(user), id, 'rejected');
  }

  @Get('history')
  @ZResponse(200, historySchema)
  async history(@CurrentUser() user: AuthUser) {
    return this.assistant.history(await this.advisorId(user));
  }

  @Delete('history/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async remove(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.assistant.deleteInteraction(await this.advisorId(user), id);
  }

  @Get('settings')
  @ZResponse(200, settingsSchema)
  async settings(@CurrentUser() user: AuthUser) {
    return this.assistant.getSettings(await this.advisorId(user));
  }

  @Put('settings')
  @ZResponse(200, settingsSchema)
  async putSettings(
    @CurrentUser() user: AuthUser,
    @ZBody(settingsSchema) body: z.infer<typeof settingsSchema>,
  ) {
    return this.assistant.putSettings(await this.advisorId(user), body);
  }
}

/** Admin: rebuild the shared knowledge index now (it also runs nightly). */
@ApiTags('ai')
@Controller({ path: 'ai/admin', version: '1' })
@Roles('admin')
export class AiAdminController {
  constructor(
    private readonly indexer: IndexerService,
    private readonly db: Database,
  ) {}

  @Post('reindex')
  @HttpCode(HttpStatus.ACCEPTED)
  @ZResponse(202, reindexResultSchema)
  async reindex() {
    await this.db.transaction('ai', (tx) =>
      tx.enqueue('ai.index-shared', {}, { jobKey: 'ai.index-shared.manual' }),
    );
    return { queued: true };
  }
}
