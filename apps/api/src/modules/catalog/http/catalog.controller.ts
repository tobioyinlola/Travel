import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { IdentityApi } from '../../identity/index.js';
import { CurrentUser, Roles, type AuthUser } from '../../../platform/http/auth.js';
import { ProblemException, problemType } from '../../../platform/http/problem.js';
import { ZBody, ZQuery, ZResponse } from '../../../platform/http/zod.js';
import { SearchService } from '../application/search.service.js';
import {
  checkRateResponseSchema,
  checkRateSchema,
  propertySchema,
  searchQuerySchema,
  searchResponseSchema,
} from './schemas.js';

/** Hotel search and live rates for members (FR-INV-04/05/06). */
@ApiTags('catalog')
@Controller({ path: 'catalog', version: '1' })
@Roles('advisor', 'support', 'admin')
export class CatalogController {
  constructor(
    private readonly search: SearchService,
    private readonly identity: IdentityApi,
  ) {}

  private async member(user: AuthUser): Promise<void> {
    if (user.role === 'advisor')
      await this.identity.requireAdvisor(user.id, ['approved', 'active']);
  }

  @Get('destinations')
  @ZResponse(
    200,
    z.array(z.object({ slug: z.string(), name: z.string(), countryCode: z.string() })),
  )
  async destinations(@CurrentUser() user: AuthUser, @Query('q') q?: string) {
    await this.member(user);
    return this.search.destinations(q?.slice(0, 50));
  }

  @Get('search')
  @ZResponse(200, searchResponseSchema)
  async hotels(
    @CurrentUser() user: AuthUser,
    @ZQuery(searchQuerySchema as unknown as z.ZodObject) q: z.infer<typeof searchQuerySchema>,
  ) {
    await this.member(user);
    return this.search.search({ ...q, childrenAges: q.childrenAges ?? [] });
  }

  @Post('rates/check')
  @HttpCode(HttpStatus.OK)
  @ZResponse(200, checkRateResponseSchema)
  async check(
    @CurrentUser() user: AuthUser,
    @ZBody(checkRateSchema) body: z.infer<typeof checkRateSchema>,
  ) {
    await this.member(user);
    const r = await this.search.checkRate(body.rateKey, body.currency);
    return r
      ? { available: true, ...r }
      : { available: false, rate: null, property: null, preferred: null };
  }

  @Get('properties/:id')
  @ZResponse(200, propertySchema)
  async property(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.member(user);
    const p = await this.search.getProperty(id);
    if (!p)
      throw new ProblemException(
        HttpStatus.NOT_FOUND,
        problemType('not-found'),
        'Property not found',
      );
    return p;
  }
}
