// Public interface of the commission-payments module. Other modules may import ONLY from this file.
export { CommissionPaymentsModule } from './commission-payments.module.js';
export { PAYMENT_PROVIDER } from './application/payment-provider.port.js';
export { FakePaymentProvider } from './infrastructure/fake-payment-provider.js';
