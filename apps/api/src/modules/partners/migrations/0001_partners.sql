-- Preferred partner program (FR-PRT-01). Perk delivery tracking (FR-PRT-03) arrives with bookings.

CREATE TABLE partners.suppliers (
  id                uuid PRIMARY KEY,
  name              text NOT NULL UNIQUE,
  type              text NOT NULL CHECK (type IN ('hotel', 'hotel_group', 'cruise_line', 'tour_operator')),
  commission_terms  text NOT NULL DEFAULT '',
  payout_terms      text NOT NULL DEFAULT '',
  created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE partners.programs (
  id           uuid PRIMARY KEY,
  supplier_id  uuid NOT NULL REFERENCES partners.suppliers (id),
  name         text NOT NULL,
  tier         text NOT NULL CHECK (tier IN ('preferred', 'luxury', 'exclusive')),
  description  text NOT NULL DEFAULT '',
  perks        jsonb NOT NULL DEFAULT '[]',     -- [{ "kind": "breakfast", "description": "Daily breakfast for two" }]
  rate_codes   text[] NOT NULL DEFAULT '{}',    -- empty: every rate at the property qualifies
  active       boolean NOT NULL DEFAULT true,
  valid_from   date,
  valid_to     date,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  version      integer NOT NULL DEFAULT 1,
  CHECK (valid_to IS NULL OR valid_from IS NULL OR valid_to >= valid_from)
);

-- Catalog property ids (opaque here: Partners does not read Catalog's tables).
CREATE TABLE partners.program_properties (
  program_id   uuid NOT NULL REFERENCES partners.programs (id),
  property_id  uuid NOT NULL,
  PRIMARY KEY (program_id, property_id)
);
