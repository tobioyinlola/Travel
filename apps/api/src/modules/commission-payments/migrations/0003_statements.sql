-- Supplier commission statements and their matching (FR-COM-04, 05). Replaces the manual release of Sprint 6.

ALTER TABLE commission.commissions ADD COLUMN confirmation_code text;
ALTER TABLE commission.commissions ADD COLUMN advisor_user_id uuid;
CREATE INDEX commissions_confirmation_idx ON commission.commissions (supplier, confirmation_code);

CREATE TABLE commission.statements (
  id            uuid PRIMARY KEY,
  supplier      text NOT NULL,
  reference     text NOT NULL,                 -- the supplier's statement number
  currency      char(3) NOT NULL,
  total_minor   bigint NOT NULL,
  file_hash     text NOT NULL UNIQUE,          -- the same statement cannot be imported twice
  imported_by   uuid,
  imported_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE commission.statement_lines (
  id                uuid PRIMARY KEY,
  statement_id      uuid NOT NULL REFERENCES commission.statements (id),
  supplier          text NOT NULL,
  confirmation_code text NOT NULL,
  amount_minor      bigint NOT NULL CHECK (amount_minor >= 0),
  currency          char(3) NOT NULL,
  status            text NOT NULL CHECK (status IN ('matched', 'mismatch', 'unmatched', 'resolved', 'rejected')),
  commission_id     uuid REFERENCES commission.commissions (id),
  expected_minor    bigint,
  variance_minor    bigint,                    -- paid minus expected
  resolved_by       uuid,
  resolved_at       timestamptz,
  note              text
);
CREATE INDEX statement_lines_statement_idx ON commission.statement_lines (statement_id);
CREATE INDEX statement_lines_status_idx ON commission.statement_lines (status);
-- A commission can be settled by at most one statement line.
CREATE UNIQUE INDEX statement_lines_one_settlement ON commission.statement_lines (commission_id)
  WHERE status IN ('matched', 'resolved');
