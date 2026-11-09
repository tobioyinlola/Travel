import { Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { Public } from '../../../platform/http/auth.js';
import { ZBody, ZResponse } from '../../../platform/http/zod.js';
import { ProposalLinkService } from '../application/proposal-link.service.js';
import { decisionSchema, travelerProposalSchema } from './schemas.js';

/** The traveler's proposal link: no account, the token is the credential (FR-ITN-04/06, FR-TRV-01..03). */
@ApiTags('proposal-link')
@Controller({ path: 'proposal-links', version: '1' })
@Public()
export class ProposalLinkController {
  constructor(private readonly links: ProposalLinkService) {}

  @Get(':token')
  @ZResponse(200, travelerProposalSchema)
  async view(@Param('token') token: string, @Req() req: Request) {
    await this.links.rateLimit(req.ip ?? 'unknown');
    return this.links.view(token);
  }

  @Post(':token/decision')
  @HttpCode(HttpStatus.OK)
  @ZResponse(200, travelerProposalSchema)
  async decide(
    @Param('token') token: string,
    @ZBody(decisionSchema) body: z.infer<typeof decisionSchema>,
    @Req() req: Request,
  ) {
    await this.links.rateLimit(req.ip ?? 'unknown');
    return this.links.decide(token, body.decision, { name: body.name, note: body.note });
  }
}
