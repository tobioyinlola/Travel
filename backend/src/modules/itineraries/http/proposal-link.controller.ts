import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Public } from '../../../platform/http/auth.js';
import { ZBody, ZQuery, ZResponse } from '../../../platform/http/zod.js';
import { MessagesService } from '../application/messages.service.js';
import { ProposalLinkService } from '../application/proposal-link.service.js';
import {
  decisionSchema,
  messageListSchema,
  travelerMessageSchema,
  travelerProposalSchema,
  uploadQuery,
  uploadedFileSchema,
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

  /** Raw file bytes (Content-Type: application/pdf, image/png or image/jpeg); attach by id when sending a message. */
  @Post(':token/attachments')
  @ZResponse(201, uploadedFileSchema)
  async upload(
    @Param('token') token: string,
    @ZQuery(uploadQuery) q: z.infer<typeof uploadQuery>,
    @Body() bytes: unknown,
    @Req() req: Request,
  ) {
    await this.links.rateLimit(req.ip ?? 'unknown');
    return this.messages.travelerUpload(token, q.filename, bytes);
  }

  @Get(':token/attachments/:id')
  async download(
    @Param('token') token: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
    @Req() req: Request,
  ) {
    await this.links.rateLimit(req.ip ?? 'unknown');
    sendFile(res, await this.messages.travelerDownload(token, id));
  }
}

/** Always a download, never rendered in our origin. */
export function sendFile(
  res: Response,
  f: { filename: string; contentType: string; data: Buffer },
) {
  res
    .status(200)
    .type(f.contentType)
    .setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(f.filename)}`,
    )
    .setHeader('Content-Length', f.data.length)
    .end(f.data);
}
