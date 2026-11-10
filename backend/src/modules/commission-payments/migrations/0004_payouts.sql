-- Payouts to advisors (FR-COM-07, 09). Runs need two approvals; an advisor must pass the gate (AC-07);
-- commission already paid out and later reversed is taken from the next payout (AC-08).

INSERT INTO commission.accounts (code, name, kind) VALUES
  ('advisor_receivable', 'Advisor owes us (commission clawed back)', 'asset');

CREATE TABLE commission.payout_accounts (
  advisor_id   uuid PRIMARY KEY,
  account_ref  text NOT NULL,              -- the provider's token for the advisor's bank account; no bank details here
  country      char(2) NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE commission.advisor_holds (
  id            uuid PRIMARY KEY,
  advisor_id    uuid NOT NULL,
  reason        text NOT NULL,
  placed_by     uuid NOT NULL,
  placed_at     timestamptz NOT NULL DEFAULT now(),
  released_by   uuid,
  released_at   timestamptz,
  release_note  text
);
CREATE UNIQUE INDEX advisor_holds_one_active ON commission.advisor_holds (advisor_id) WHERE released_at IS NULL;

CREATE TABLE commission.adjustments (
  id            uuid PRIMARY KEY,
  advisor_id    uuid NOT NULL,
  amount_minor  bigint NOT NULL CHECK (amount_minor <> 0),   -- positive pays the advisor, negative takes back
  currency      char(3) NOT NULL,
  reason_code   text NOT NULL CHECK (reason_code IN ('goodwill', 'correction', 'fee', 'other')),
  note          text NOT NULL,
  created_by    uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE commission.advisor_debts (
  id             uuid PRIMARY KEY,
  advisor_id     uuid NOT NULL,
  commission_id  uuid NOT NULL UNIQUE REFERENCES commission.commissions (id),
  amount_minor   bigint NOT NULL CHECK (amount_minor > 0),
  applied_minor  bigint NOT NULL DEFAULT 0 CHECK (applied_minor >= 0 AND applied_minor <= amount_minor),
  currency       char(3) NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE commission.payout_runs (
  id            uuid PRIMARY KEY,
  currency      char(3) NOT NULL,
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'completed', 'cancelled')),
  created_by    uuid NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  approved_at   timestamptz,
  completed_at  timestamptz
);
CREATE TABLE commission.payout_run_approvals (
  run_id       uuid NOT NULL REFERENCES commission.payout_runs (id),
  user_id      uuid NOT NULL,
  approved_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (run_id, user_id)
);

CREATE TABLE commission.payouts (
  id               uuid PRIMARY KEY,
  run_id           uuid NOT NULL REFERENCES commission.payout_runs (id),
  advisor_id       uuid NOT NULL,
  advisor_user_id  uuid,
  currency         char(3) NOT NULL,
  gross_minor      bigint NOT NULL CHECK (gross_minor >= 0),
  debt_minor       bigint NOT NULL DEFAULT 0 CHECK (debt_minor >= 0),
  net_minor        bigint NOT NULL CHECK (net_minor >= 0),
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'failed', 'skipped')),
  skip_reason      text,
  provider_ref     text,
  failure_reason   text,
  paid_at          timestamptz,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK (gross_minor - debt_minor = net_minor)
);
CREATE INDEX payouts_advisor_idx ON commission.payouts (advisor_id, created_at DESC);
CREATE INDEX payouts_run_idx ON commission.payouts (run_id);
CREATE TABLE commission.payout_items (
  payout_id      uuid NOT NULL REFERENCES commission.payouts (id),
  commission_id  uuid NOT NULL REFERENCES commission.commissions (id),
  PRIMARY KEY (payout_id, commission_id)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payout_accounts', 'payouts'] LOOP
    EXECUTE format('ALTER TABLE commission.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE commission.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY advisor_owns ON commission.%I USING (commission.visible(advisor_id)) WITH CHECK (commission.visible(advisor_id))', t);
  END LOOP;
END $$;
