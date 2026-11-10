import { Controller, Get, Param, Put } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { AuditWriter } from '../../../platform/audit/audit-writer.js';
import { FeatureFlags } from '../../../platform/feature-flags.js';
import { CurrentUser, Roles, type AuthUser } from '../../../platform/http/auth.js';
import { ZBody, ZResponse } from '../../../platform/http/zod.js';
import { MembershipApi } from '../../membership/index.js';

const money = z.object({ amountMinor: z.string(), currency: z.string() });
const flagSchema = z.object({
  key: z.string(),
  enabled: z.boolean(),
  description: z.string(),
  updatedAt: z.iso.datetime(),
  updatedBy: z.uuid().nullable(),
});
const flagsSchema = z.object({ items: z.array(flagSchema) });
const flagBody = z.object({ enabled: z.boolean() });

const planBody = z.object({
  name: z.string().trim().min(2).max(100),
  billingPeriod: z.enum(['quarter', 'year']),
  priceMinor: z.string().regex(/^\d{1,10}$/),
  currency: z
    .string()
    .regex(/^[A-Z]{3}$/)
    .default('USD'),
  active: z.boolean().default(true),
});
const planSchema = z.object({
  code: z.string(),
  name: z.string(),
  billingPeriod: z.enum(['quarter', 'year']),
  price: money,
  active: z.boolean(),
});
const plansSchema = z.object({ items: z.array(planSchema) });

const tierBody = z.object({
  tiers: z
    .array(
      z.object({
        code: z.string().regex(/^[a-z][a-z0-9_]{1,30}$/),
        name: z.string().trim().min(2).max(50),
        minSalesMinor: z.string().regex(/^\d{1,12}$/),
        advisorShareBps: z.number().int().min(0).max(10000),
      }),
    )
    .min(1)
    .max(10),
});
const tiersSchema = z.object({
  items: z.array(
    z.object({
      code: z.string(),
      name: z.string(),
      position: z.number().int(),
      minSales: money,
      advisorShareBps: z.number().int(),
    }),
  ),
});

/** Configuration an admin changes without a deploy (FR-ADM-04): kill switches, plans, split tiers. Partner programs and
 * promo codes have their own endpoints above. */
@ApiTags('admin')
@Controller({ path: 'admin', version: '1' })
@Roles('admin')
export class ConfigAdminController {
  constructor(
    private readonly flags: FeatureFlags,
    private readonly membership: MembershipApi,
    private readonly audit: AuditWriter,
  ) {}

  @Get('flags')
  @ZResponse(200, flagsSchema)
  async listFlags() {
    return { items: await this.flags.list() };
  }

  @Put('flags/:key')
  @ZResponse(200, flagSchema)
  async setFlag(
    @CurrentUser() user: AuthUser,
    @Param('key') key: string,
    @ZBody(flagBody) body: z.infer<typeof flagBody>,
  ) {
    const flag = await this.flags.set(key, body.enabled, user.id);
    await this.audit.record({
      actorType: 'user',
      actorId: user.id,
      action: body.enabled ? 'flag.enabled' : 'flag.disabled',
      entityType: 'feature_flag',
      entityId: key,
      module: 'admin',
    });
    return flag;
  }

  @Get('plans')
  @ZResponse(200, plansSchema)
  async plans() {
    return { items: await this.membership.listAllPlans() };
  }

  /** Create or change a plan. Existing invoices are untouched; renewals and new sign-ups use the new price. */
  @Put('plans/:code')
  @ZResponse(200, planSchema)
  upsertPlan(
    @CurrentUser() user: AuthUser,
    @Param('code') code: string,
    @ZBody(planBody) body: z.infer<typeof planBody>,
  ) {
    return this.membership.upsertPlan({ code: code.toLowerCase(), ...body }, user.id);
  }

  @Get('tiers')
  @ZResponse(200, tiersSchema)
  async tiers() {
    return { items: await this.membership.listTiers() };
  }

  /** Replace the split ladder. Applies to sales recognised from now on. */
  @Put('tiers')
  @ZResponse(200, tiersSchema)
  async putTiers(@CurrentUser() user: AuthUser, @ZBody(tierBody) body: z.infer<typeof tierBody>) {
    return { items: await this.membership.replaceTiers(body.tiers, user.id) };
  }
}
