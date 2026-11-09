import { Module } from '@nestjs/common';

/**
 * Identity module (foundation layer). Auth, roles, MFA, advisor application, KYC result, contractor agreement (FR-AUTH).
 * Owns schema(s): identity.
 * May call (public interfaces only): shared-kernel.
 */
@Module({
  providers: [],
  exports: [],
})
export class IdentityModule {}
