import { Module } from '@nestjs/common';

/**
 * Membership module (core domain layer). Plans, billing, renewals and split tiers (FR-MEM).
 * Owns schema(s): membership.
 * May call (public interfaces only): shared-kernel, identity, notifications, audit.
 */
@Module({
  providers: [],
  exports: [],
})
export class MembershipModule {}
