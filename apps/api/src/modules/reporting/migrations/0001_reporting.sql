-- Reporting read model (FR-RPT-01..03, 06). One row per business fact, built from events only; reports are
-- queries over it. Nothing here is a source of truth, so it can always be rebuilt by replaying events.
-- (ARCH calls for a read replica; with a single database these are ordinary queries on indexed tables.)

CREATE TABLE reporting.facts (
  event_id      uuid PRIMARY KEY,           -- the event that produced it: replays cannot double count
  kind          text NOT NULL,              -- see docs/FUNNEL_EVENTS.md
  advisor_id    uuid,
  subject_id    uuid,                       -- booking, proposal, commission, payout, ... the fact is about
  supplier      text,
  amount_minor  bigint NOT NULL DEFAULT 0,
  currency      char(3),
  props         jsonb NOT NULL DEFAULT '{}',
  occurred_at   timestamptz NOT NULL
);
CREATE INDEX facts_kind_time_idx ON reporting.facts (kind, occurred_at);
CREATE INDEX facts_advisor_idx ON reporting.facts (advisor_id, kind, occurred_at);
CREATE INDEX facts_supplier_idx ON reporting.facts (supplier, kind) WHERE supplier IS NOT NULL;

-- One event can yield several facts (a booking confirmation yields one per hotel): derive a stable id per position.
CREATE FUNCTION reporting.fact_id(base uuid, n integer) RETURNS uuid LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN n = 0 THEN base ELSE md5(base::text || ':' || n::text)::uuid END
$$;
