# ADR-19: Sprint 8 decisions (AI assistant, membership renewals)

- Status: Accepted (Sprint 8)

## 1. The model sits behind a port; today it is a stand-in (D8 open)

`ModelPort` has `embed` and `generate`. The fake embeds with hashed word vectors and "generates" by quoting the
best-matching sentences of the retrieved sources with citation markers. It cannot invent facts, so grounding,
flagging and approval logic are tested honestly. A hosted model replaces it in Sprint 10; its adapter must treat the
sources as untrusted quoted data. pgvector is not available in every environment, so embeddings are stored as
arrays and similarity is computed in the application over the owner-filtered candidates; swap for a vector index
when volumes need it.

## 2. What it knows, and whose notes it may use (FR-AI-01, FR-AI-08, AC-10)

Shared documents: catalog properties, active partner programs, course lessons. Private documents: an advisor's own
client notes and preferences. Retrieval is filtered by owner in the query and again by row-level security. Client
documents are rebuilt from the Clients module before each retrieval that may use them, so archived or erased
clients disappear immediately; turning "use my client notes" off deletes them at once. Answers cite numbered sources
and say which ones were actually used.

## 3. Honesty about what it cannot verify (FR-AI-06)

Every answer has a confidence (from retrieval strength). Sentences with prices, policies or perks are flagged
"unverified" unless the perk comes from an active partner program; flags cap confidence below "high". When nothing
relevant is found it says so instead of answering, and a draft is refused rather than invented.

## 4. It never contacts a traveler (FR-AI-03, AC-09)

There is no send path in the AI module. A draft is only visible to its advisor, can be edited, approved or
rejected, and approving records the decision and the final wording; it does not send anything either. Tests assert
that no message is sent at creation or approval.

## 5. Logging and control (FR-AI-05)

Every question and draft is stored with the prompt, the retrieval tool call and result count, the retrieved sources,
the output, confidence, flags, model and latency. Advisors see and can delete their own history, and can switch
the assistant or client-note use off. Supplier-supplied text is sanitised per sentence before indexing (instruction-
like text and hidden characters removed, counted on the document).

## 6. Membership renewals and dunning (FR-MEM-03)

A daily job: reminds advisors a week before renewal (once per period), opens a renewal invoice when a period ends
(the next period starts where the last ended; full price, no promo), and retries declined renewals after 1, 3 and 7
days. The membership is `past_due` during that grace period and a new card pays the open invoice at once. After the
fourth failure the invoice is voided and the membership cancelled. Cancel-at-period-end memberships do not renew.
The provider idempotency key now includes the attempt number.

## Not done

Admin tools for suspending or offboarding advisors (FR-ADM-02) and configuration without deploys (FR-ADM-04),
and reporting (FR-RPT), are Sprint 9. A lapsed membership does not yet suspend the advisor. The assistant has no
itinerary or booking context and does not call live rates. Real model, evaluation set and cost controls: Sprint 10.
