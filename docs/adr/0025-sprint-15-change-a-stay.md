# ADR-25: Sprint 15 decisions (changing a confirmed stay)

- Status: Accepted (Sprint 15)

## 1. Scope

Until now a confirmed booking could only have its guest details changed; moving dates, changing room or hotel meant
cancel and rebook. This adds `POST /v1/bookings/{id}/lines/{lineId}/replace {rateKey}` (advisor, Idempotency-Key).
The advisor picks the new offer from a normal hotel search; the server re-prices it live, so the client never supplies
a price or commission.

## 2. Make before break

1. The new offer is checked live and a new line is added as `pending`, linked to the old one (`replaces_line_id`,
   `replace_state = open`). The booking goes `confirmed -> modified`.
2. The new hotel is reserved by the same job as any line (same idempotency discipline, retries, support queue).
3. Only when it is confirmed is the old hotel cancelled. If the new one refuses, the old stay is untouched, the
   attempt is hidden, the booking returns to `confirmed` and the advisor is told. It can be tried again.
4. When both are settled the booking total is recomputed and `BookingLineReplaced` is published once.

## 3. Money: nothing is charged without the traveler

- The old stay must be free to cancel (inside its window, refundable). Otherwise 409 `penalty-applies`: changing would cost
  the traveler, so it needs their agreement.
- Pay at hotel: any new price (nothing was collected). Prepay: the new stay may cost the same or less; the difference
  (less any fee the old hotel still charged) is refunded through Payments (`stay_changed`). A dearer stay, or any
  deposit booking, is refused (409 `price-increase`): the traveler has paid and must approve a new proposal.
- Same travelers only (adults and ages), same booking currency, and the traveler's payment mode must still be offered.

## 4. Commission

Commission is per line already. On `BookingLineReplaced` Commission reverses the old line's commission (with the
existing rules: write-off before the supplier paid, clawback after payout) and recognises the new line from the
supplier-confirmed terms, so the ledger stays balanced. A later cancellation reverses the remaining line only; the old
one is not reversed twice.

## 5. Not done

Guest-visible comparison of old and new, an email specific to a stay change (the traveler gets the existing
"booking updated" message), and a traveler-approved price increase (needs a new approval flow on the booking).
