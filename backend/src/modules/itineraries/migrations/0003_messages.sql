-- Message thread between the traveler (via the proposal link) and the advisor (FR-TRV-06).
-- One thread per trip, so it survives new proposal versions. Advisor-owned: forced row-level security.
CREATE TABLE itineraries.messages (
  id                uuid PRIMARY KEY,
  trip_id           uuid NOT NULL REFERENCES itineraries.trips (id),
  owner_advisor_id  uuid NOT NULL,
  sender            text NOT NULL CHECK (sender IN ('traveler', 'advisor')),
  sender_name       text NOT NULL,
  body              text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 4000),
  created_at        timestamptz NOT NULL DEFAULT now(),
  read_at           timestamptz
);
CREATE INDEX messages_trip_idx ON itineraries.messages (trip_id, created_at);
CREATE INDEX messages_unread_idx ON itineraries.messages (owner_advisor_id) WHERE sender = 'traveler' AND read_at IS NULL;

ALTER TABLE itineraries.messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE itineraries.messages FORCE ROW LEVEL SECURITY;
CREATE POLICY advisor_owns ON itineraries.messages
  USING (itineraries.visible(owner_advisor_id)) WITH CHECK (itineraries.visible(owner_advisor_id));
