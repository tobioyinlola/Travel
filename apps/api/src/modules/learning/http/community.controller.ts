import {
  Controller,
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
import { ForumService } from '../application/forum.service.js';
import {
  editSchema,
  moderationActionSchema,
  replySchema,
  reportQueueSchema,
  reportSchema,
  topicCreateSchema,
  topicListQuery,
  topicSchema,
  topicSummarySchema,
} from './schemas.js';

const idResponse = z.object({ id: z.uuid() });

/** Moderated community forum (FR-CMT-01). */
@ApiTags('community')
@Controller({ path: 'community', version: '1' })
@Roles('advisor', 'support', 'admin')
export class CommunityController {
  constructor(private readonly forum: ForumService) {}

  @Get('categories')
  @ZResponse(
    200,
    z.array(
      z.object({
        slug: z.string(),
        name: z.string(),
        description: z.string(),
        topicCount: z.number(),
      }),
    ),
  )
  async categories(@CurrentUser() user: AuthUser) {
    await this.forum.member(user);
    return this.forum.categories();
  }

  @Get('topics')
  @ZResponse(
    200,
    z.object({ items: z.array(topicSummarySchema), nextCursor: z.string().nullable() }),
  )
  async topics(
    @CurrentUser() user: AuthUser,
    @ZQuery(topicListQuery) q: z.infer<typeof topicListQuery>,
  ) {
    return this.forum.listTopics(await this.forum.member(user), q);
  }

  @Post('topics')
  @ZResponse(201, idResponse)
  async create(
    @CurrentUser() user: AuthUser,
    @ZBody(topicCreateSchema) body: z.infer<typeof topicCreateSchema>,
  ) {
    return this.forum.createTopic(await this.forum.member(user), body);
  }

  @Get('topics/:id')
  @ZResponse(200, topicSchema)
  async topic(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.forum.getTopic(await this.forum.member(user), id);
  }

  @Patch('topics/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async editTopic(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(editSchema) body: z.infer<typeof editSchema>,
  ) {
    await this.forum.edit(await this.forum.member(user), 'topic', id, body.body);
  }

  @Post('topics/:id/replies')
  @ZResponse(201, idResponse)
  async reply(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(replySchema) body: z.infer<typeof replySchema>,
  ) {
    return this.forum.reply(await this.forum.member(user), id, body.body);
  }

  @Patch('posts/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  async editPost(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(editSchema) body: z.infer<typeof editSchema>,
  ) {
    await this.forum.edit(await this.forum.member(user), 'post', id, body.body);
  }

  @Post('reports')
  @HttpCode(HttpStatus.ACCEPTED)
  @ZResponse(202, z.object({ hidden: z.boolean() }))
  async report(
    @CurrentUser() user: AuthUser,
    @ZBody(reportSchema) body: z.infer<typeof reportSchema>,
  ) {
    return this.forum.report(
      await this.forum.member(user),
      body.targetType,
      body.targetId,
      body.reason,
    );
  }

  @Get('moderation/reports')
  @Roles('support', 'admin')
  @ZResponse(200, reportQueueSchema)
  async reports(@CurrentUser() user: AuthUser) {
    await this.forum.member(user);
    return this.forum.openReports();
  }

  @Post('moderation/:type/:id')
  @Roles('support', 'admin')
  @HttpCode(HttpStatus.NO_CONTENT)
  async moderate(
    @CurrentUser() user: AuthUser,
    @Param('type') type: string,
    @Param('id', ParseUUIDPipe) id: string,
    @ZBody(moderationActionSchema) body: z.infer<typeof moderationActionSchema>,
  ) {
    const target = z.enum(['topic', 'post']).parse(type);
    await this.forum.moderate(await this.forum.member(user), target, id, body.action);
  }
}
