# Runbook: reconciliation variance

**Signals:** `atp_ledger_variance_minor != 0` (page), or Admin > Finance shows "Reconciliation: Failed".
The check: ledger debits equal credits, and the ledger's receivable equals the expected commission still waiting.
The target is exactly zero; any difference is a defect, not noise.

**Different from statement lines to decide.** Variances in supplier statements ("Variances to decide") are normal
work for finance (accept or dispute). They do not make the ledger variance non-zero.

**Do this:**

1. Open Admin > Finance and `GET /v1/finance/ledger/trial-balance`. If debits <> credits, stop payouts: do not approve
   any payout run. The database should make this impossible (balanced check on commit), so treat it as a possible
   database or migration problem and escalate to engineering at once.
2. If balanced but the receivable differs from expected commissions: find commissions whose status disagrees with
   their ledger entries (a commission `expected` with a `release` transaction, or the reverse). Compare
   `commission.commissions` with `commission.ledger_txns` by `ref_id`.
3. Fix with a new, reversing or adjusting entry, never by editing or deleting (the ledger is append-only by trigger).
   Use an adjustment with a reason code for advisor balances; engineering posts corrections for the rest.
4. Record what happened and why in the incident log. Re-run `GET /v1/finance/reconciliation` until `ok` is true.
