import { FakeModel } from '../src/modules/ai/infrastructure/fake-model.js';
import { FakeHotelSupplier } from '../src/modules/catalog/index.js';
import { FakePaymentProvider } from '../src/modules/commission-payments/infrastructure/fake-payment-provider.js';
import { FakePayoutProvider } from '../src/modules/commission-payments/infrastructure/fake-payout-provider.js';
import {
  FakeKycProvider,
  FakeSignatureProvider,
} from '../src/modules/identity/infrastructure/fake-providers.js';
import { FakeBilling } from '../src/modules/membership/index.js';
import { MemoryMessaging } from '../src/modules/notifications/index.js';
import {
  billingContract,
  hotelSupplierContract,
  identityProvidersContract,
  messagingContract,
  modelContract,
  paymentProviderContract,
  payoutProviderContract,
} from './contracts/adapters.js';
import { inDays } from './app-harness.js';

// Each fake must satisfy the contract the platform relies on. A real adapter is added to this file with the same
// suite and its sandbox fixtures, and must pass before PROVIDERS_MODE=live is allowed for it (docs/ADAPTER_CONTRACTS.md).
const stay = {
  checkIn: inDays(60),
  checkOut: inDays(63),
  currency: 'USD',
  occupancy: { adults: 2, childrenAges: [] },
};

hotelSupplierContract('fake wholesaler A', () => new FakeHotelSupplier('fake-wholesaler-a'), stay);
hotelSupplierContract('fake wholesaler B', () => new FakeHotelSupplier('fake-wholesaler-b'), stay);
paymentProviderContract('fake payments', () => new FakePaymentProvider());
payoutProviderContract('fake payouts', () => new FakePayoutProvider(), {
  goodAccount: 'acct_fake_ok',
  refusedAccount: 'acct_fake_closed',
});
billingContract('fake billing', () => new FakeBilling(), {
  goodMethod: 'pm_fake_visa',
  declinedMethod: 'pm_fake_declined',
});
modelContract('fake extractive model', () => new FakeModel());
identityProvidersContract(
  'fakes',
  () => new FakeKycProvider('http://localhost:3000'),
  () => new FakeSignatureProvider('http://localhost:3000'),
);
messagingContract('in-memory email', () => new MemoryMessaging());
