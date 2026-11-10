import { Controller, Get, HttpCode, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditWriter } from '../../../platform/audit/audit-writer.js';
import { CurrentUser, Roles, type AuthUser } from '../../../platform/http/auth.js';
import { ZBody, ZResponse } from '../../../platform/http/zod.js';
import { DeadLetterService } from '../../../platform/jobs/dead-letters.js';

const listSchema = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      task: z.string(),
      attempts: z.number().int(),
      maxAttempts: z.number().int(),
      lastError: z.string().nullable(),
      createdAt: z.iso.datetime(),
    }),
  ),
});
const replayBody = z.object({
  ids: z
    .array(z.string().regex(/^\d{1,18}$/))
    .min(1)
    .max(100),
});
const replaySchema = z.object({ replayed: z.number().int() });

/** Jobs that ran out of retries wait here for a person (ARCH jobs: dead letters with replay). */
@ApiTags('admin')
@Controller({ path: 'admin/dead-letters', version: '1' })
@Roles('admin')
export class DeadLettersController {
  constructor(
    private readonly dead: DeadLetterService,
    private readonly audit: AuditWriter,
  ) {}

  @Get()
  @ZResponse(200, listSchema)
  async list() {
    const rows = await this.dead.list(200);
    return { items: rows.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })) };
  }

  /** Run the listed jobs again from the start. Fix the cause first: a job that fails again goes straight back. */
  @Post('replay')
  @HttpCode(HttpStatus.OK)
  @ZResponse(200, replaySchema)
  async replay(@CurrentUser() user: AuthUser, @ZBody(replayBody) body: z.infer<typeof replayBody>) {
    const replayed = await this.dead.replay(body.ids);
    await this.audit.record({
      actorType: 'user',
      actorId: user.id,
      action: 'jobs.dead_letters_replayed',
      entityType: 'jobs',
      entityId: body.ids.join(','),
      module: 'admin',
      metadata: { count: replayed },
    });
    return { replayed };
  }
}
