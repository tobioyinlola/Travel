# Adapter contracts

Every external dependency sits behind a port, and every port has a contract suite in
`apps/api/test/contracts/adapters.ts`. The suites describe what the platform relies on (idempotent calls, refusals
as results rather than exceptions, money as whole minor units, never citing sources it was not given), not how any
provider works.

| Port                     | Fake today            | Real adapter (decision)                       | Status                    |
| ------------------------ | --------------------- | --------------------------------------------- | ------------------------- |
| HotelSupplierPort        | two fake wholesalers  | hotel aggregator (D2)                         | open                      |
| PaymentProviderPort      | FakePaymentProvider   | card processor with hosted fields (D4)        | open                      |
| PayoutProviderPort       | FakePayoutProvider    | payout rails by advisor country (D4)          | open                      |
| BillingPort (membership) | FakeBilling           | same processor, subscriptions or charges (D4) | open                      |
| IdentityVerificationPort | FakeKycProvider       | KYC provider (D5)                             | open                      |
| SignaturePort            | FakeSignatureProvider | e-sign provider (D5)                          | open                      |
| MessagingPort            | SMTP, log, memory     | transactional email provider                  | SMTP ready, provider open |
| ModelPort                | FakeModel             | hosted language model (D8)                    | open                      |

## Adding a real adapter

1. Implement the port in the owning module's `infrastructure/` folder. Keep every provider-specific type inside it.
2. Add it to `apps/api/test/adapters.test.ts` with the same suite and the provider's **sandbox** fixtures
   (test card tokens, a refused bank account, sandbox hotel ids). The suite must pass against the sandbox.
3. Wire it in the module's `forRoot` when `PROVIDERS_MODE=live` (today those throw "not implemented"; that is
   deliberate, so a live deployment cannot silently run on fakes: `loadConfig` also refuses `fake` in production).
4. Webhook providers: register a `WebhookProvider` with the real signature check; the inbox pipeline
   (verify, store, acknowledge, process, de-duplicate) is already shared.
5. Provider secrets come from the secret store, never the repository; field-level encryption keys likewise.
