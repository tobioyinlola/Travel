# ADR-22: Sprint 11 decisions (gaps that need no provider)

- Status: Accepted (Sprint 11)

## 1. Scope

Provider adapters are still waiting on decisions D2-D5 and D8. Sprint 11 closed product gaps that need none of them:
the traveler message thread (FR-TRV-06), password reset, session revocation, staff web access (these three earlier in
the gap fixes), and draft privacy and terms pages.

## 2. One thread per trip, reached through the proposal link

Messages hang off the trip, not a proposal version, so a conversation survives price refreshes. The traveler reaches
it with the same secret link as the proposal (the token is the credential, as in ADR-11): any live proposal token of
the trip works. Public routes are rate limited per address and 20 messages an hour per link. The advisor side is
owner-only through forced row-level security (`itineraries.messages`), so another advisor gets 404.

## 3. Emails carry a pointer, not the text

"New message" emails to the advisor name the sender and trip and link to the app; the text is not in the email or in
the event. The advisor's reply emails the traveler their private link (secret, stored redacted like the proposal
email) and only when the client has an address and the link is still live.

## 4. Not built (still open)

Attachments (FR-TRV-06 mentions documents; needs file storage and scanning), date and room changes on a confirmed
booking (needs supplier change semantics and price differences; today it is cancel and rebook), and the real
adapters. The pilot fee waiver already has a cap and an expiry through promo codes (`maxRedemptions`, expiry).
Privacy and terms are drafts and must be reviewed by counsel.
