import { Controller, Get, HttpStatus, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { CurrentUser, Roles, type AuthUser } from '../../../platform/http/auth.js';
import { ProblemException, problemType } from '../../../platform/http/problem.js';
import { ZBody, ZResponse } from '../../../platform/http/zod.js';
import { AdvisorsService } from '../application/advisors.service.js';
import { applicationSchema, applicationViewSchema } from './schemas.js';

/** The signed-in advisor's own application (FR-AUTH-03..05). */
@ApiTags('advisor-application')
@Controller({ path: 'advisor-application', version: '1' })
@Roles('advisor')
export class ApplicationController {
  constructor(private readonly advisors: AdvisorsService) {}

  @Get()
  @ZResponse(200, applicationViewSchema)
  async get(@CurrentUser() user: AuthUser) {
    const app = await this.advisors.getApplicationForUser(user.id);
    if (!app)
      throw new ProblemException(
        HttpStatus.NOT_FOUND,
        problemType('not-found'),
        'No application yet',
      );
    return app;
  }

  /** Submit, or resubmit after the review team asked for more information. */
  @Post()
  @ZResponse(201, applicationViewSchema)
  submit(
    @CurrentUser() user: AuthUser,
    @ZBody(applicationSchema) body: z.infer<typeof applicationSchema>,
  ) {
    return this.advisors.submitApplication(user.id, body);
  }
}
