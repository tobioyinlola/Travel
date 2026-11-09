-- Trips, itinerary items and proposals (FR-ITN-01..06, FR-TRV-01..03).
-- Advisor-owned: forced row-level security, as in the clients schema (ADR-12).

CREATE FUNCTION itineraries.visible(owner uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT current_setting('atp.scope', true) = 'all'
      OR owner = nullif(current_setting('atp.advisor_id', true), '')::uuid
$$;

CREATE TABLE itineraries.trips (
  id                  uuid PRIMARY KEY,
  owner_advisor_id    uuid NOT NULL,
  client_id           uuid NOT NULL,
  title               text NOT NULL,
  start_date          date NOT NULL,
  end_date            date NOT NULL CHECK (end_date >= start_date),
  adults              integer NOT NULL CHECK (adults BETWEEN 1 AND 12),
  children_ages       integer[] NOT NULL DEFAULT '{}',
  currency            char(3) NOT NULL,
  planning_fee_minor  bigint NOT NULL DEFAULT 0 CHECK (planning_fee_minor >= 0),
  notes               text NOT NULL DEFAULT '',
  status              text NOT NULL DEFAULT 'planning'
                        CHECK (status IN ('planning', 'proposed', 'approved', 'cancelled')),
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  version             integer NOT NULL DEFAULT 1
);
CREATE INDEX trips_owner_idx ON itineraries.trips (owner_advisor_id, status, start_date);
CREATE INDEX trips_client_idx ON itineraries.trips (client_id);

CREATE TABLE itineraries.items (
  id                uuid PRIMARY KEY,
  trip_id           uuid NOT NULL REFERENCES itineraries.trips (id),
  owner_advisor_id  uuid NOT NULL,
  kind              text NOT NULL CHECK (kind IN ('hotel', 'activity', 'transfer', 'note')),
  day               date NOT NULL,
  position          integer NOT NULL,
  title             text NOT NULL,
  details           text NOT NULL DEFAULT '',
  start_time        text CHECK (start_time ~ '^([01][0-9]|2[0-3]):[0-5][0-9]$'),
  location          text,
  price_minor       bigint CHECK (price_minor >= 0),   -- manual items
  rate              jsonb,                             -- hotel: live-checked rate + property snapshot
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK ((kind = 'hotel') = (rate IS NOT NULL))
);
CREATE INDEX items_trip_idx ON itineraries.items (trip_id, day, position);

CREATE TABLE itineraries.proposals (
  id                uuid PRIMARY KEY,
  trip_id           uuid NOT NULL REFERENCES itineraries.trips (id),
  owner_advisor_id  uuid NOT NULL,
  advisor_user_id   uuid NOT NULL,          -- who to notify about the traveler's decision
  version           integer NOT NULL,
  status            text NOT NULL CHECK (status IN ('published', 'approved', 'changes_requested', 'declined', 'superseded')),
  snapshot          jsonb NOT NULL,       -- immutable once published (FR-ITN-07 history, AC-02 lock)
  totals            jsonb NOT NULL,
  -- The link token: SHA-256 for lookup, AES-GCM copy so the advisor can show the link again.
  token_hash        text UNIQUE,
  token_enc         text,
  token_expires_at  timestamptz NOT NULL,
  rates_checked_at  timestamptz NOT NULL,
  rates_expire_at   timestamptz NOT NULL,
  published_at      timestamptz NOT NULL DEFAULT now(),
  first_viewed_at   timestamptz,
  decided_at        timestamptz,
  decided_by_name   text,
  decision_note     text,
  UNIQUE (trip_id, version)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['trips', 'items', 'proposals'] LOOP
    EXECUTE format('ALTER TABLE itineraries.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE itineraries.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY advisor_owns ON itineraries.%I USING (itineraries.visible(owner_advisor_id)) WITH CHECK (itineraries.visible(owner_advisor_id))', t);
  END LOOP;
END $$;
