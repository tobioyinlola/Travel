# ADR-23: Sprint 12 decisions (tax identifier, unread badge)

- Status: Accepted (Sprint 12)

## 1. Scope

Still no provider decisions, so Sprint 12 closed the remaining provider-free gaps: tax identifier collection at
application, an unread-message badge on Trips, and an accessibility re-check of the pages added in Sprints 11-12.

## 2. Tax identifier

Optional on the application. The value is encrypted with the field key (`identity.advisors.tax_id_enc`); only the last
four characters are kept in clear for display (`tax_id_last4`). It is removed from the input before the audit log is
written, appears in no event and no API response (the view returns `provided` and `last4`), and resubmitting without
it keeps what is on file. Reading the full value back is deliberately not exposed yet: the first consumer will be the
payout provider adapter, which should decrypt inside its own call and record the access in the audit log.

## 3. Unread badge

Trips shows the count of unread traveler messages (`GET /v1/trips/messages/unread`, polled every 30 s).

## 4. Accessibility

New public pages (sign-in link target, forgot and reset password, privacy, terms) checked with axe-core, WCAG 2.1 AA,
light and dark: no violations, no CSP messages. The signed-in sweep (`scripts/a11y-sweep.cjs`) was not re-run for the
message thread and tax field; run it before the pilot.
