-- Client CRM (FR-CRM-01, 02, 03, 07, 08).
-- Every table carries owner_advisor_id and is protected by row-level security as defence in depth
-- (ARCH security: "PostgreSQL row-level security on advisor-owned tables"). The module sets
-- atp.advisor_id (or atp.scope = 'all' for staff and jobs) at the start of each transaction.

CREATE FUNCTION clients.visible(owner uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT current_setting('atp.scope', true) = 'all'
      OR owner = nullif(current_setting('atp.advisor_id', true), '')::uuid
$$;

CREATE TABLE clients.clients (
  id                uuid PRIMARY KEY,
  owner_advisor_id  uuid NOT NULL,
  first_name        text NOT NULL,
  last_name         text NOT NULL,
  email             citext,
  phone             text,
  date_of_birth     date,
  home_city         text,
  notes             text NOT NULL DEFAULT '',
  preferences       jsonb NOT NULL DEFAULT '{}',
  status            text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived', 'erased')),
  erased_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  version           integer NOT NULL DEFAULT 1
);
CREATE INDEX clients_owner_name_idx ON clients.clients (owner_advisor_id, status, lower(last_name), lower(first_name), id);
CREATE INDEX clients_search_idx ON clients.clients
  USING gin ((first_name || ' ' || last_name || ' ' || coalesce(email::text, '')) gin_trgm_ops);

CREATE TABLE clients.companions (
  id                uuid PRIMARY KEY,
  client_id         uuid NOT NULL REFERENCES clients.clients (id),
  owner_advisor_id  uuid NOT NULL,
  first_name        text NOT NULL,
  last_name         text NOT NULL,
  relationship      text NOT NULL,
  date_of_birth     date,
  notes             text NOT NULL DEFAULT '',
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX companions_client_idx ON clients.companions (client_id);

-- Trip history projected from Itineraries and Booking events (wired in Sprint 3+, FR-CRM-03).
CREATE TABLE clients.trip_history (
  trip_id           uuid PRIMARY KEY,
  client_id         uuid NOT NULL REFERENCES clients.clients (id),
  owner_advisor_id  uuid NOT NULL,
  title             text NOT NULL,
  start_date        date,
  end_date          date,
  status            text NOT NULL,
  booking_ids       uuid[] NOT NULL DEFAULT '{}',
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trip_history_client_idx ON clients.trip_history (client_id, start_date DESC);

CREATE TABLE clients.privacy_requests (
  id                 uuid PRIMARY KEY,
  client_id          uuid NOT NULL REFERENCES clients.clients (id),
  owner_advisor_id   uuid NOT NULL,
  kind               text NOT NULL CHECK (kind IN ('export', 'delete')),
  status             text NOT NULL DEFAULT 'requested'
                       CHECK (status IN ('requested', 'verified', 'completed', 'rejected')),
  requested_by       uuid NOT NULL,
  requester_note     text NOT NULL DEFAULT '',
  verified_by        uuid,
  verification_note  text,
  rejected_reason    text,
  export_payload     jsonb,             -- purged 30 days after completion
  due_at             timestamptz NOT NULL,  -- NFR-10: within 30 days
  created_at         timestamptz NOT NULL DEFAULT now(),
  verified_at        timestamptz,
  completed_at       timestamptz
);
CREATE INDEX privacy_requests_status_idx ON clients.privacy_requests (status, due_at);
CREATE UNIQUE INDEX privacy_requests_one_open ON clients.privacy_requests (client_id, kind)
  WHERE status IN ('requested', 'verified');

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['clients', 'companions', 'trip_history', 'privacy_requests'] LOOP
    EXECUTE format('ALTER TABLE clients.%I ENABLE ROW LEVEL SECURITY', t);
    -- FORCE: the policy applies to the owning role too, which is the role the module runs as.
    EXECUTE format('ALTER TABLE clients.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY advisor_owns ON clients.%I USING (clients.visible(owner_advisor_id)) WITH CHECK (clients.visible(owner_advisor_id))', t);
  END LOOP;
END $$;
