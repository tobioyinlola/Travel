import { DynamicModule, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { APP_CONFIG, type AppConfig } from '../../config.js';
import { AuthGuard, SESSION_RESOLVER } from '../../platform/http/auth.js';
import { AdvisorsService } from './application/advisors.service.js';
import { AuthService } from './application/auth.service.js';
import { IdentityApi } from './application/identity-api.js';
import { IDENTITY_VERIFICATION_PORT, SIGNATURE_PORT } from './application/ports.js';
import { ApplicationController } from './http/application.controller.js';
import { AuthController } from './http/auth.controller.js';
import { FakeProvidersController } from './http/fake-providers.controller.js';
import { FakeKycProvider, FakeSignatureProvider } from './infrastructure/fake-providers.js';

/**
 * Identity module (foundation layer). Auth, roles, MFA, advisor application, KYC result, contractor
 * agreement (FR-AUTH). Owns schema: identity. May call: shared-kernel only.
 */
@Module({})
export class IdentityModule {
  static forRoot(config: AppConfig): DynamicModule {
    const fake = config.PROVIDERS_MODE === 'fake';
    if (!fake)
      throw new Error('Live KYC and e-signature adapters are not implemented yet (Sprint 10)');
    return {
      module: IdentityModule,
      global: true, // exports only the public API (IdentityApi, AuthService)
      controllers: [
        AuthController,
        ApplicationController,
        ...(fake ? [FakeProvidersController] : []),
      ],
      providers: [
        AuthService,
        AdvisorsService,
        IdentityApi,
        {
          provide: IDENTITY_VERIFICATION_PORT,
          inject: [APP_CONFIG],
          useFactory: (c: AppConfig) => new FakeKycProvider(c.WEB_BASE_URL),
        },
        {
          provide: SIGNATURE_PORT,
          inject: [APP_CONFIG],
          useFactory: (c: AppConfig) => new FakeSignatureProvider(c.WEB_BASE_URL),
        },
        {
          provide: SESSION_RESOLVER,
          inject: [AuthService],
          useFactory: (a: AuthService) => a.sessions,
        },
        { provide: APP_GUARD, useClass: AuthGuard },
      ],
      exports: [IdentityApi, AuthService],
    };
  }
}
