-- Traveler payments (FR-PAY-01, 02). Card data never reaches us: the provider's hosted fields return a
-- token, we hold only provider references. Money is bigint minor units + currency.

CREATE TABLE payments.payments (
  id              uuid PRIMARY KEY,
  booking_id      uuid NOT NULL,
  proposal_id     uuid NOT NULL,
  advisor_id      uuid NOT NULL,
  amount_minor    bigint NOT NULL CHECK (amount_minor > 0),
  currency        char(3) NOT NULL,
  status          text NOT NULL DEFAULT 'requires_payment'
                    CHECK (status IN ('requires_payment', 'captured', 'failed', 'expired',
                                      'partially_refunded', 'refunded')),
  disputed        boolean NOT NULL DEFAULT false,
  -- Booking failed or was cancelled: money arriving now goes straight back.
  booking_closed  boolean NOT NULL DEFAULT false,
  provider        text,
  provider_ref    text UNIQUE,        -- set once the provider has created the intent
  client_token    text,               -- what the traveler's browser needs for the hosted fields
  refunded_minor  bigint NOT NULL DEFAULT 0 CHECK (refunded_minor >= 0),
  failure_reason  text,
  expires_at      timestamptz,
  captured_at     timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (refunded_minor <= amount_minor)
);
CREATE INDEX payments_booking_idx ON payments.payments (booking_id, created_at);

CREATE TABLE payments.refunds (
  id               uuid PRIMARY KEY,
  payment_id       uuid NOT NULL REFERENCES payments.payments (id),
  booking_id       uuid NOT NULL,
  amount_minor     bigint NOT NULL CHECK (amount_minor > 0),
  reason           text NOT NULL,
  status           text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'succeeded', 'failed')),
  provider_ref     text,
  failure_reason   text,
  -- One refund per cause: a redelivered event cannot refund twice.
  idempotency_key  text NOT NULL UNIQUE,
  created_at       timestamptz NOT NULL DEFAULT now(),
  completed_at     timestamptz
);
CREATE INDEX refunds_payment_idx ON payments.refunds (payment_id);

CREATE TABLE payments.disputes (
  id            uuid PRIMARY KEY,
  payment_id    uuid NOT NULL REFERENCES payments.payments (id),
  provider_ref  text NOT NULL UNIQUE,
  amount_minor  bigint NOT NULL CHECK (amount_minor > 0),
  reason        text NOT NULL,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'won', 'lost')),
  opened_at     timestamptz NOT NULL DEFAULT now()
);
