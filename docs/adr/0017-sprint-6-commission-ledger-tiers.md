# ADR-17: Sprint 6 decisions (commission, ledger, split tiers, perks)

- Status: Accepted (Sprint 6)

## 1. Commission is recognised when the booking is confirmed

`BookingConfirmed` carries each hotel's commissionable amount, rate and line id. For each line, Commission stores
one record (unique per line, so a redelivered event cannot double count): expected = commissionable x rate
(FR-COM-01), then split by the advisor's tier at that moment (FR-COM-02). All money maths is bigint with half-even
rounding; the platform share is the remainder, so advisor + platform always equals the whole.
AC-05 is a unit test: $2,500 x 12% = $300 -> $210 advisor / $90 platform at the 70% base split.

## 2. Double-entry ledger (append-only, balanced by the database)

Accounts: `supplier_receivable`, `cash_clearing`, `advisor_commission_pending`, `advisor_payable`,
`platform_revenue`. Entries cannot be updated or deleted (triggers) and every transaction must balance when it
commits (deferred constraint trigger); a unique (kind, ref) per transaction makes each posting happen once.
Corrections are new, opposite transactions. `GET /v1/finance/ledger/trial-balance` shows debits = credits.

- Recognition: Dr supplier_receivable; Cr platform_revenue + advisor_commission_pending.
- Release (supplier paid): Dr cash_clearing, Cr supplier_receivable; Dr pending, Cr advisor_payable.
- Reversal before payment: write off the receivable. After payment: money back to the supplier, payable removed.

## 3. Payable only after the supplier pays (D6)

The advisor's share stays in `pending` until finance records the supplier's payment
(`POST /v1/finance/commissions/:id/release`, finance or admin). This manual step is a stand-in: Sprint 7 replaces it
with supplier statement import and reconciliation, which will also use the `received`/`reconciled` states already
in the schema. Paying advisors out (statuses `paid`) and recovering already-paid commission from the next payout
(AC-07, AC-08) are Sprint 7-8; a reversal on a `paid` commission is only flagged in the audit log for now.

## 4. Split tiers are prospective (D7, AC-06)

Membership keeps calendar-year commissionable sales per advisor from `CommissionRecognized` / `CommissionReversed`
events, picks the highest tier reached (placeholder ladder: Starter 70%, Pro 75% from $300K, Elite 80% from $750K,
stored as data) and emits `TierChanged`. Commission reads the split at recognition time, so the sale that crosses
$300K keeps its old split and later sales get the new one. A reversal can move an advisor back down. Tiers are in
USD only until multi-currency (NFR-14); other currencies use the base split.

## 5. Partner perks on confirmed bookings (FR-PRT-02)

Partners records, per hotel, the programs in force today that cover the property and (if they list rate codes)
match the booked rate. The booking card shows them. This is a record of what was promised; no supplier call.

## Not done

Cancellation penalties do not reduce commission separately (a cancelled booking earns nothing). Invoicing suppliers
(`invoiced`), statement matching and variance alerts are Sprint 7. Tier names and shares are unconfirmed business
inputs.
