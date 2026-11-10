-- Files attached to trip messages (FR-TRV-06). Bytes live in Postgres for the pilot (5 MB cap each); the scan result
-- is recorded with the file. Same row-level security as messages.
CREATE TABLE itineraries.attachments (
  id                uuid PRIMARY KEY,
  trip_id           uuid NOT NULL REFERENCES itineraries.trips (id),
  owner_advisor_id  uuid NOT NULL,
  message_id        uuid REFERENCES itineraries.messages (id),
  uploader          text NOT NULL CHECK (uploader IN ('traveler', 'advisor')),
  filename          text NOT NULL CHECK (char_length(filename) BETWEEN 1 AND 200),
  content_type      text NOT NULL CHECK (content_type IN ('application/pdf', 'image/png', 'image/jpeg')),
  size_bytes        integer NOT NULL CHECK (size_bytes BETWEEN 1 AND 5242880),
  sha256            text NOT NULL,
  scanner           text NOT NULL,
  data              bytea NOT NULL,
  created_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX attachments_trip_idx ON itineraries.attachments (trip_id, created_at);
CREATE INDEX attachments_message_idx ON itineraries.attachments (message_id);

ALTER TABLE itineraries.attachments ENABLE ROW LEVEL SECURITY;
ALTER TABLE itineraries.attachments FORCE ROW LEVEL SECURITY;
CREATE POLICY advisor_owns ON itineraries.attachments
  USING (itineraries.visible(owner_advisor_id)) WITH CHECK (itineraries.visible(owner_advisor_id));
