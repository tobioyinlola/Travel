import { Module } from '@nestjs/common';

/**
 * CommissionPayments module (orchestration layer). Traveler payments, commission ledger, reconciliation, payouts (FR-PAY, FR-COM).
 * Owns schema(s): commission, payments.
 * May call (public interfaces only): shared-kernel, identity, notifications, audit, clients, catalog, partners, membership, learning.
 */
@Module({
  providers: [],
  exports: [],
})
export class CommissionPaymentsModule {}
