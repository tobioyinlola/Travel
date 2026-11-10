-- Commission (FR-COM-01..03, 05, 06) and the double-entry ledger it posts to.
-- Advisor-owned: forced row-level security, as elsewhere (ADR-12).

CREATE FUNCTION commission.visible(owner uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT current_setting('atp.scope', true) = 'all'
      OR owner = nullif(current_setting('atp.advisor_id', true), '')::uuid
$$;

-- ---------------------------------------------------------------- ledger
CREATE TABLE commission.accounts (
  code    text PRIMARY KEY,
  name    text NOT NULL,
  kind    text NOT NULL CHECK (kind IN ('asset', 'liability', 'revenue'))
);
INSERT INTO commission.accounts (code, name, kind) VALUES
  ('supplier_receivable',        'Commission owed to us by suppliers',          'asset'),
  ('cash_clearing',              'Money received, not yet paid out',            'asset'),
  ('advisor_commission_pending', 'Advisor share earned, supplier not yet paid', 'liability'),
  ('advisor_payable',            'Advisor share payable',                       'liability'),
  ('platform_revenue',           'Platform share of commission',                'revenue');

CREATE TABLE commission.ledger_txns (
  id           uuid PRIMARY KEY,
  kind         text NOT NULL,                -- recognition | release | reversal | ...
  ref_type     text NOT NULL,
  ref_id       uuid NOT NULL,
  description  text NOT NULL,
  currency     char(3) NOT NULL,
  posted_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, ref_type, ref_id)            -- a posting happens once per cause
);

CREATE TABLE commission.ledger_entries (
  id            bigserial PRIMARY KEY,
  txn_id        uuid NOT NULL REFERENCES commission.ledger_txns (id),
  account       text NOT NULL REFERENCES commission.accounts (code),
  advisor_id    uuid,
  direction     text NOT NULL CHECK (direction IN ('debit', 'credit')),
  amount_minor  bigint NOT NULL CHECK (amount_minor > 0),
  currency      char(3) NOT NULL
);
CREATE INDEX ledger_entries_txn_idx ON commission.ledger_entries (txn_id);
CREATE INDEX ledger_entries_account_idx ON commission.ledger_entries (account, advisor_id);

-- Append-only: corrections are new, reversing transactions (ARCH "Money and the ledger").
CREATE FUNCTION commission.forbid_change() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'The ledger is append-only (% on %)', TG_OP, TG_TABLE_NAME;
END $$;
CREATE TRIGGER ledger_entries_immutable BEFORE UPDATE OR DELETE ON commission.ledger_entries
  FOR EACH ROW EXECUTE FUNCTION commission.forbid_change();
CREATE TRIGGER ledger_txns_immutable BEFORE UPDATE OR DELETE ON commission.ledger_txns
  FOR EACH ROW EXECUTE FUNCTION commission.forbid_change();

-- Every transaction must balance, checked when it commits.
CREATE FUNCTION commission.check_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE d bigint; c bigint;
BEGIN
  SELECT coalesce(sum(amount_minor) FILTER (WHERE direction = 'debit'), 0),
         coalesce(sum(amount_minor) FILTER (WHERE direction = 'credit'), 0)
    INTO d, c FROM commission.ledger_entries WHERE txn_id = NEW.txn_id;
  IF d <> c THEN
    RAISE EXCEPTION 'Unbalanced ledger transaction %: debits % credits %', NEW.txn_id, d, c;
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ledger_balanced AFTER INSERT ON commission.ledger_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION commission.check_balanced();

-- ---------------------------------------------------------------- commissions
CREATE TABLE commission.commissions (
  id                    uuid PRIMARY KEY,
  booking_id            uuid NOT NULL,
  line_id               uuid NOT NULL UNIQUE,         -- one commission per hotel reservation
  advisor_id            uuid NOT NULL,
  supplier              text NOT NULL,
  property_name         text NOT NULL,
  check_in              date NOT NULL,
  check_out             date NOT NULL,
  currency              char(3) NOT NULL,
  commissionable_minor  bigint NOT NULL CHECK (commissionable_minor >= 0),
  rate_bps              integer NOT NULL CHECK (rate_bps BETWEEN 0 AND 10000),
  expected_minor        bigint NOT NULL CHECK (expected_minor >= 0),
  tier_code             text NOT NULL,                -- the tier at recognition (FR-COM-02)
  advisor_share_bps     integer NOT NULL,
  advisor_minor         bigint NOT NULL CHECK (advisor_minor >= 0),
  platform_minor        bigint NOT NULL CHECK (platform_minor >= 0),
  status                text NOT NULL DEFAULT 'expected'
                          CHECK (status IN ('expected', 'invoiced', 'received', 'reconciled', 'payable', 'paid', 'reversed')),
  reversal_reason       text,
  recognized_at         timestamptz NOT NULL DEFAULT now(),
  received_at           timestamptz,
  released_at           timestamptz,
  reversed_at           timestamptz,
  updated_at            timestamptz NOT NULL DEFAULT now(),
  CHECK (advisor_minor + platform_minor = expected_minor)
);
CREATE INDEX commissions_advisor_idx ON commission.commissions (advisor_id, status, recognized_at DESC);
CREATE INDEX commissions_booking_idx ON commission.commissions (booking_id);

ALTER TABLE commission.commissions ENABLE ROW LEVEL SECURITY;
ALTER TABLE commission.commissions FORCE ROW LEVEL SECURITY;
CREATE POLICY advisor_owns ON commission.commissions
  USING (commission.visible(advisor_id)) WITH CHECK (commission.visible(advisor_id));
