-- Perks attached to a confirmed booking (FR-PRT-02): a record of what the traveler was promised.
CREATE TABLE partners.booking_perks (
  line_id       uuid NOT NULL,
  program_id    uuid NOT NULL REFERENCES partners.programs (id),
  booking_id    uuid NOT NULL,
  advisor_id    uuid NOT NULL,
  program_name  text NOT NULL,
  tier          text NOT NULL,
  perks         jsonb NOT NULL,
  attached_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (line_id, program_id)
);
CREATE INDEX booking_perks_booking_idx ON partners.booking_perks (booking_id);
