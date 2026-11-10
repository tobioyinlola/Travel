# Funnel and reporting events (FR-RPT-06)

Reports read one table, `reporting.facts`, filled only from domain events. Each fact has: `kind`, `advisor_id`,
`subject_id` (the booking, proposal, commission, payout... it is about), `supplier`, `amount_minor` + `currency`,
`props` (JSON), `occurred_at`. The event id is the fact's key, so replaying events never double counts. The table can
be dropped and rebuilt by replaying the outbox.

| kind                                                                       | Source event                     | amount_minor  | props                                         |
| -------------------------------------------------------------------------- | -------------------------------- | ------------- | --------------------------------------------- |
| application_submitted                                                      | AdvisorApplicationSubmitted      |               |                                               |
| advisor_approved / advisor_active / advisor_suspended / advisor_offboarded | AdvisorStatusChanged (to)        |               | from                                          |
| proposal_published                                                         | ProposalPublished                |               | version                                       |
| proposal_approved                                                          | ProposalApproved                 |               | hotels                                        |
| booking_confirmed                                                          | BookingConfirmed                 | booking total |                                               |
| booking_line_confirmed                                                     | BookingConfirmed (one per hotel) | hotel total   | bookingId, commissionable                     |
| booking_cancelled                                                          | BookingCancelled                 | refund        | penalty                                       |
| booking_failed                                                             | BookingFailed                    |               | reason                                        |
| commission_recognized                                                      | CommissionRecognized             | advisor share | expected, platformShare, commissionable, tier |
| commission_released                                                        | CommissionReleased               | advisor share |                                               |
| commission_reversed                                                        | CommissionReversed               | advisor share | wasPayable                                    |
| supplier_payment_received                                                  | SupplierPaymentReceived          | amount        |                                               |
| payout_paid                                                                | PayoutPaid                       | net amount    |                                               |

Funnel for an advisor: `application_submitted` -> `advisor_approved` -> `advisor_active` -> first
`booking_confirmed`. Funnel for a trip: `proposal_published` -> `proposal_approved` -> `booking_confirmed`.
Adding a metric means adding a mapping in `facts.service.ts` and a row here.
