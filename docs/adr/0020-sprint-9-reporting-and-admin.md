# ADR-20: Sprint 9 decisions (reporting, advisor lifecycle, configuration)

- Status: Accepted (Sprint 9)

## 1. Reporting is a read model built from events (FR-RPT-01..03, 06)

One table, `reporting.facts`, filled only from domain events (the funnel schema is in docs/FUNNEL_EVENTS.md). The
event id is the fact's key, so redelivery never double counts, and the table can be rebuilt by replaying events.
Reports are plain aggregate queries: the advisor dashboard (pipeline, bookings, commission, tier progress, top
suppliers), a finance report (recognised, received, payable, paid, outstanding, by supplier) and platform metrics
(activation funnel, median days from active to first booking, active advisors, GMV, bookings by supplier).
ARCH's read replica is not needed with one database; the queries are the same. Facts exist from this release on;
earlier history needs an outbox replay (the outbox keeps 14 days). USD only until multi-currency (NFR-14).

## 2. Advisor lifecycle (FR-ADM-02)

Suspend, reinstate and offboard are status changes in Identity with a reason and an audit row; the state machine
decides what is allowed (offboarding is final). A suspended advisor loses the assistant, new bookings (their
travelers' checkout is refused) and payouts. Offboarding with open bookings (not yet submitted, in progress, or with
a stay still to come) requires an active successor: Booking reassigns the bookings, Itineraries moves their trips,
Clients moves those trips' clients, all by events, then Identity offboards. The steps are safe to repeat. Finished
stays and commission already earned stay with the original advisor. Offboarded advisors are still paid what they
earned: the payout gate treats `offboarded` as eligible (suspended is not).

## 3. Configuration without a deploy (FR-ADM-04)

- Feature flags live in one platform table every process re-reads every five seconds. `new_bookings` pauses
  checkout (503 for submitting, viewing still works) and `ai_assistant` pauses the assistant, for incidents. An
  unknown flag counts as on.
- Plans are data: create, change price, retire. New sign-ups and renewals use the new price; issued invoices are
  untouched.
- The split ladder can be edited under rules (starts at zero, thresholds rise, shares never fall, no tier removed,
  codes unique). It applies to sales recognised afterwards.
- Partner programs and promo codes already had admin endpoints. Every change is audited with before and after.

## Not done

Other numbers that are still constants (payout minimum, deposit percentage, rate expiry) are not yet editable. The
finance role can call the finance and report APIs but only admins have a web login. Suspending does not revoke an
advisor's open sessions; the gates take effect on the next request. Reassigning does not notify the new advisor.
