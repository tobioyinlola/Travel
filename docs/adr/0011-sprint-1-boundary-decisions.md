# ADR-11: Boundary decisions made in Sprint 1 (identity, notifications, membership)

- Status: Accepted (Sprint 1)

Each of these resolves a place where the module map in ARCH, applied literally, would have blocked a
requirement.

## 1. Audit writing is a platform service

FR-AUTH-09 needs every login and status change audited **in the same transaction** as the change. Identity
and Audit are both foundation modules, and same-layer modules may not call each other. Writing therefore
moves to `platform/audit/AuditWriter` (it inserts into `audit.log` under the audit role, joining the caller's
transaction). The audit module keeps the schema, partition maintenance and the read side (`AuditLog`).

## 2. Notifications keeps its own recipient list

Notifications (foundation) may not call Identity (foundation) for an email address. Identity publishes
`UserRegistered` with contact details, and Notifications projects them into `notifications.recipients`.
`VerificationCodeIssued` carries the destination and the 6-digit code; the code is short-lived and
single-use and stays in `platform.outbox` only until the 14-day cleanup. The message log stores
`[redacted]` for that template; the text travels only inside the send job.

## 3. Membership has its own BillingPort

ARCH puts `PaymentProviderPort` in Payments (orchestration). Membership (core domain) may not call it, and
membership fees are a subscription product, usually a different API from traveler payments anyway.
Membership owns `BillingPort`; the live adapter (decision D4) will probably be the same provider.

## 4. Onboarding order (resolves plan inconsistency #3)

FR-MEM-02 says "charge on approval"; AC-01 says payment success makes the advisor Approved. Implemented:

1. Applicant submits (`applied`), completes KYC and signs the agreement -> `under_review` automatically.
2. Advisor chooses a plan, optional promo code and a card (no charge yet).
3. Admin **accepts** (recorded as `accepted_at`; status stays `under_review`) -> `AdvisorApplicationAccepted`.
4. Membership charges the first invoice. On success, in one transaction: invoice paid, membership active,
   advisor `approved` (`AdvisorApproved`). A waiver code skips the charge. A decline leaves the advisor in
   `under_review` and emails them; a new card retries the same invoice.
5. Essentials passed -> `active` (FR-AUTH-07 booking gate). Either order works.

## 5. `rejected` status

FR-AUTH-06 lists Applied, Under review, Approved, Active, Suspended, Offboarded. ADM-01 lets admins reject
an application, and no listed status describes that, so `rejected` is added as a terminal status.

## 6. Sessions in Redis, MFA via TOTP

Per ARCH: httpOnly SameSite=Lax cookie holding a random token; Redis stores only its SHA-256. MFA is TOTP
(RFC 6238) with 10 single-use recovery codes; the secret is encrypted with AES-256-GCM (`FieldCrypto`).
A TOTP step can be used once (replay protection). Sessions rotate when MFA is passed. Lockout: 5 failed
attempts per account (50 per IP) locks for 15 minutes.
