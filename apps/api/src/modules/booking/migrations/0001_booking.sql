-- Bookings (FR-BKG-01..06). One booking per approved proposal; one line per hotel reservation.
-- Advisor-owned: forced row-level security, as in itineraries (ADR-12).

CREATE FUNCTION booking.visible(owner uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT current_setting('atp.scope', true) = 'all'
      OR owner = nullif(current_setting('atp.advisor_id', true), '')::uuid
$$;

CREATE TABLE booking.bookings (
  id                    uuid PRIMARY KEY,
  proposal_id           uuid NOT NULL UNIQUE,   -- AC-04: a proposal is booked at most once
  trip_id               uuid NOT NULL,
  owner_advisor_id      uuid NOT NULL,
  advisor_user_id       uuid NOT NULL,
  trip_title            text NOT NULL,
  currency              char(3) NOT NULL,
  status                text NOT NULL DEFAULT 'draft'
                          CHECK (status IN ('draft', 'pending', 'confirmed', 'failed', 'modified',
                                            'cancelled', 'completed', 'reversed')),
  payment_mode          text CHECK (payment_mode IN ('pay_at_hotel', 'prepay', 'deposit')),
  total_minor           bigint NOT NULL CHECK (total_minor >= 0),
  due_now_minor         bigint NOT NULL DEFAULT 0 CHECK (due_now_minor >= 0),
  paid_minor            bigint NOT NULL DEFAULT 0 CHECK (paid_minor >= 0),
  refunded_minor        bigint NOT NULL DEFAULT 0 CHECK (refunded_minor >= 0),
  penalty_minor         bigint NOT NULL DEFAULT 0 CHECK (penalty_minor >= 0),
  payment_state         text NOT NULL DEFAULT 'none'
                          CHECK (payment_state IN ('none', 'awaiting', 'captured', 'failed',
                                                   'partially_refunded', 'refunded')),
  payment_client_token  text,
  payment_expires_at    timestamptz,
  payment_failure       text,
  traveler_enc          text,                   -- AES-GCM JSON: name, email, phone, special requests
  confirm_key           text,                   -- the Idempotency-Key that moved the booking forward
  failure_reason        text,
  cancel_requested_at   timestamptz,
  cancel_reason         text,
  -- The traveler reaches checkout with the proposal link token (hash only; same expiry as the link).
  token_hash            text NOT NULL UNIQUE,
  link_expires_at       timestamptz NOT NULL,
  blocked_notified_at   timestamptz,           -- the advisor was told a price moved or a hotel sold out
  pending_since         timestamptz,
  confirmed_at          timestamptz,
  cancelled_at          timestamptz,
  completed_at          timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX bookings_owner_idx ON booking.bookings (owner_advisor_id, status, created_at DESC);
CREATE INDEX bookings_trip_idx ON booking.bookings (trip_id);
CREATE INDEX bookings_pending_idx ON booking.bookings (pending_since) WHERE status = 'pending';

CREATE TABLE booking.lines (
  id                       uuid PRIMARY KEY,
  booking_id               uuid NOT NULL REFERENCES booking.bookings (id),
  owner_advisor_id         uuid NOT NULL,
  item_id                  uuid NOT NULL,
  position                 integer NOT NULL,
  status                   text NOT NULL DEFAULT 'pending'
                             CHECK (status IN ('pending', 'confirmed', 'failed', 'cancelled')),
  supplier                 text NOT NULL,
  rate_key                 text NOT NULL,
  property_name            text NOT NULL,
  city                     text NOT NULL,
  check_in                 date NOT NULL,
  check_out                date NOT NULL,
  nights                   integer NOT NULL,
  room_name                text NOT NULL,
  board                    text NOT NULL,
  adults                   integer NOT NULL,
  children_ages            integer[] NOT NULL DEFAULT '{}',
  total_minor              bigint NOT NULL CHECK (total_minor >= 0),
  fees_at_hotel_minor      bigint NOT NULL DEFAULT 0,
  commissionable_minor     bigint NOT NULL DEFAULT 0,
  commission_bps           integer NOT NULL DEFAULT 0,
  payment_modes            text[] NOT NULL,
  refundable               boolean NOT NULL,
  free_cancellation_until  timestamptz,
  cancellation_policy      text NOT NULL,
  supplier_ref             text,
  confirmation_code        text,
  supplier_response        jsonb,               -- raw provider answer, kept for support (FR-BKG-04)
  failure_reason           text,
  penalty_minor            bigint NOT NULL DEFAULT 0,
  attempts                 integer NOT NULL DEFAULT 0,
  created_at               timestamptz NOT NULL DEFAULT now(),
  updated_at               timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX lines_booking_idx ON booking.lines (booking_id, position);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['bookings', 'lines'] LOOP
    EXECUTE format('ALTER TABLE booking.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE booking.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY advisor_owns ON booking.%I USING (booking.visible(owner_advisor_id)) WITH CHECK (booking.visible(owner_advisor_id))', t);
  END LOOP;
END $$;
