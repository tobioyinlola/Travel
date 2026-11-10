import { DynamicModule, Module } from '@nestjs/common';
import type { AppConfig } from '../../config.js';
import { PAYMENT_PROVIDER } from './application/payment-provider.port.js';
import { PaymentsService } from './application/payments.service.js';
import { FakePaymentsController } from './http/fake-payments.controller.js';
import { FakePaymentProvider } from './infrastructure/fake-payment-provider.js';

/**
 * CommissionPayments module (orchestration layer). Traveler payments now (FR-PAY); the commission ledger,
 * reconciliation and payouts follow in Sprints 6-8. Owns schemas: payments, commission.
 * Talks to Booking only through events (same layer, ADR-15).
 */
@Module({})
export class CommissionPaymentsModule {
  static forRoot(config: AppConfig): DynamicModule {
    if (config.PROVIDERS_MODE !== 'fake')
      throw new Error('Live payment adapter not implemented yet (decision D4)');
    return {
      module: CommissionPaymentsModule,
      controllers: [FakePaymentsController],
      providers: [
        PaymentsService,
        { provide: PAYMENT_PROVIDER, useValue: new FakePaymentProvider() },
      ],
      exports: [PAYMENT_PROVIDER],
    };
  }
}
