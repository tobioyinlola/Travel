-- Membership and billing (FR-MEM-01, 02, 04, 07).

CREATE TABLE membership.plans (
  id              uuid PRIMARY KEY,
  code            text NOT NULL UNIQUE,
  name            text NOT NULL,
  billing_period  text NOT NULL CHECK (billing_period IN ('quarter', 'year')),
  price_minor     bigint NOT NULL CHECK (price_minor >= 0),
  currency        char(3) NOT NULL,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

-- PRD benchmark prices. Currency is a placeholder until the launch region is chosen (decision D1);
-- plans are data, so admins change them without a deploy (FR-ADM-04).
INSERT INTO membership.plans (id, code, name, billing_period, price_minor, currency) VALUES
  ('01960000-0000-7000-8000-000000000001', 'annual', 'Annual membership', 'year', 29900, 'USD'),
  ('01960000-0000-7000-8000-000000000002', 'quarterly', 'Quarterly membership', 'quarter', 9900, 'USD');

CREATE TABLE membership.promo_codes (
  code             citext PRIMARY KEY,
  kind             text NOT NULL CHECK (kind IN ('percent_off', 'amount_off', 'waiver')),
  percent_bps      integer CHECK (percent_bps BETWEEN 1 AND 10000),
  amount_minor     bigint CHECK (amount_minor > 0),
  currency         char(3),
  description      text,
  expires_at       timestamptz,
  max_redemptions  integer CHECK (max_redemptions > 0),
  redemptions      integer NOT NULL DEFAULT 0,
  active           boolean NOT NULL DEFAULT true,
  created_by       uuid,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'percent_off') = (percent_bps IS NOT NULL)),
  CHECK ((kind = 'amount_off') = (amount_minor IS NOT NULL AND currency IS NOT NULL))
);

CREATE TABLE membership.memberships (
  id                    uuid PRIMARY KEY,
  advisor_id            uuid NOT NULL UNIQUE,
  user_id               uuid NOT NULL,
  plan_id               uuid NOT NULL REFERENCES membership.plans (id),
  status                text NOT NULL CHECK (status IN ('pending', 'active', 'past_due', 'cancelled')),
  promo_code            citext REFERENCES membership.promo_codes (code),
  payment_method_ref    text,
  application_accepted  boolean NOT NULL DEFAULT false,
  current_period_start  timestamptz,
  current_period_end    timestamptz,
  cancel_at_period_end  boolean NOT NULL DEFAULT false,
  cancelled_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  version               integer NOT NULL DEFAULT 1
);

CREATE SEQUENCE membership.invoice_number_seq;

CREATE TABLE membership.invoices (
  id                   uuid PRIMARY KEY,
  number               text NOT NULL UNIQUE,
  membership_id        uuid NOT NULL REFERENCES membership.memberships (id),
  advisor_id           uuid NOT NULL,
  description          text NOT NULL,
  period_start         timestamptz NOT NULL,
  period_end           timestamptz NOT NULL,
  subtotal_minor       bigint NOT NULL,
  discount_minor       bigint NOT NULL DEFAULT 0,
  total_minor          bigint NOT NULL CHECK (total_minor >= 0),
  currency             char(3) NOT NULL,
  status               text NOT NULL CHECK (status IN ('open', 'paid', 'void')),
  attempts             integer NOT NULL DEFAULT 0,
  last_error           text,
  provider_charge_ref  text,
  issued_at            timestamptz NOT NULL DEFAULT now(),
  paid_at              timestamptz
);
CREATE UNIQUE INDEX invoices_one_open_per_membership ON membership.invoices (membership_id) WHERE status = 'open';
