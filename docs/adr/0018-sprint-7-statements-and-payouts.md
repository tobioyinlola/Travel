# ADR-18: Sprint 7 decisions (supplier statements, reconciliation, payouts)

- Status: Accepted (Sprint 7)

## 1. Statements replace the manual release

Finance imports a supplier's statement (CSV text or JSON lines of `confirmation code, amount`). Each line is matched
to a commission by supplier and the hotel's confirmation code (stored on the commission at recognition). An exact
amount settles it: commission -> payable, ledger posted (FR-COM-04, 05). Anything else waits for a person:
a variance can be accepted (cash is booked at what was paid; the difference goes to platform revenue, the advisor's
share is unchanged) or disputed; unknown codes and codes already settled are reported as unmatched. A statement is
identified by a hash of its content, so importing it twice is refused. The Sprint 6 release endpoint is gone.
The invoicing step (`invoiced`) and per-line `reconciled` state are not separate screens: a matched line goes
straight to payable.

## 2. Daily reconciliation

`GET /v1/finance/reconciliation` and a daily job check that the ledger balances, that the ledger's
`supplier_receivable` equals the expected commission still waiting, and count open variances, unmatched lines and
commissions unpaid 30 days after check-out. Any difference is logged at error level (alerting arrives in Sprint 10).

## 3. Payout runs need two approvers

A run is a draft listing every advisor the ledger says is owed money. Two different staff members (finance or
admin) approve it; one person cannot approve twice. Only then are payout jobs queued. One run is open at a time, so
nobody is included twice. What an advisor is owed is read from the ledger (`advisor_payable`), so adjustments and
clawbacks are always counted. The payout provider is behind `PayoutProviderPort` (fake only for now; decision D4).
Advisors give a provider account token, never bank details.

## 4. The payout gate (AC-07)

An advisor is paid only if: they are Active (the same check as booking), have a payout account, have no finance
hold, and are owed at least $10. The gate runs when the run is created (skipped lines say why) and again right
before money moves, and the amount is re-checked against the ledger. The thresholds are placeholders to confirm.

## 5. Clawback (AC-08)

If a booking is cancelled after its commission was paid out, the commission is reversed in the ledger (money back
to the supplier, advisor share to `advisor_receivable`) and recorded as a debt. The next payout run deducts it:
net = owed - min(debt, owed); a debt larger than the balance is applied up to the balance and the rest carries over.
A payout with nothing left to send is settled internally without calling the provider.

## 6. Holds and adjustments (FR-COM-09)

A hold stops payouts to an advisor until released, with reason and note. An adjustment adds or removes money with a
reason code and note, posted to the ledger. Everything is audited with the acting user.

## Not done

Finance console is admin-only (the finance role has API access but no web login screen). Payout rows are created
with the run, so an advisor's balance changing between creation and approval is handled by the re-check, not by
re-computing the run. Multi-currency payouts and local-currency conversion (FR-COM-07) are not built: USD only.
Bank-account verification and payout notifications for failures are not built.
