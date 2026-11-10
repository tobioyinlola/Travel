import { DynamicModule, Module } from '@nestjs/common';
import type { AppConfig } from '../../config.js';
import { BILLING_PORT } from './application/billing.port.js';
import { MembershipApi } from './application/membership-api.js';
import { MembershipConfigService } from './application/config.service.js';
import { TiersService } from './application/tiers.service.js';
import { MembershipService } from './application/membership.service.js';
import { MembershipController } from './http/membership.controller.js';
import { FakeBilling } from './infrastructure/fake-billing.js';

/**
 * Membership module (core domain layer). Plans, billing, renewals and split tiers (FR-MEM).
 * Owns schema: membership. May call: shared-kernel, identity.
 */
@Module({})
export class MembershipModule {
  static forRoot(config: AppConfig): DynamicModule {
    if (config.PROVIDERS_MODE !== 'fake')
      throw new Error('Live billing adapter not implemented yet (decision D4)');
    return {
      module: MembershipModule,
      global: true, // exports only the public API
      controllers: [MembershipController],
      providers: [
        MembershipService,
        TiersService,
        MembershipConfigService,
        MembershipApi,
        { provide: BILLING_PORT, useValue: new FakeBilling() },
      ],
      exports: [MembershipApi, BILLING_PORT],
    };
  }
}
