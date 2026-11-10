import { Controller, Get, HttpCode, HttpStatus, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { z } from 'zod';
import { Public } from '../../../platform/http/auth.js';
import { ZBody, ZResponse } from '../../../platform/http/zod.js';
import { MessagesService } from '../application/messages.service.js';
import { ProposalLinkService } from '../application/proposal-link.service.js';
import {
  decisionSchema,
  messageListSchema,
  travelerMessageSchema,
  travelerProposalSchema,
} from './schemas.js';

/** The traveler's proposal link: no account, the token is the credential (FR-ITN-04/06, FR-TRV-01..03). */
@ApiTags('proposal-link')
@Controller({ path: 'proposal-links', version: '1' })
@Public()
export class ProposalLinkController {
  constructor(
    private readonly links: ProposalLinkService,
    private readonly messages: MessagesService,
  ) {}

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

  /** FR-TRV-06: the traveler's side of the conversation with their advisor. */
  @Get(':token/messages')
  @ZResponse(200, messageListSchema)
  async thread(@Param('token') token: string, @Req() req: Request) {
    await this.links.rateLimit(req.ip ?? 'unknown');
    return this.messages.travelerThread(token);
  }

  @Post(':token/messages')
  @ZResponse(201, messageListSchema)
  async post(
    @Param('token') token: string,
    @ZBody(travelerMessageSchema) body: z.infer<typeof travelerMessageSchema>,
    @Req() req: Request,
  ) {
    await this.links.rateLimit(req.ip ?? 'unknown');
    return this.messages.travelerPost(token, body);
  }
}
