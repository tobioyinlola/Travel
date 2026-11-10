-- Catalog: normalised hotel content, supplier mappings, preferred-partner projection (FR-INV-01, 02, 04-06).

CREATE TABLE catalog.destinations (
  id            uuid PRIMARY KEY,
  slug          text NOT NULL UNIQUE,
  name          text NOT NULL,
  country_code  char(2) NOT NULL,
  lat           double precision NOT NULL,
  lng           double precision NOT NULL,
  radius_km     integer NOT NULL
);
-- Launch destinations; more are added as data, not code.
INSERT INTO catalog.destinations (id, slug, name, country_code, lat, lng, radius_km) VALUES
  ('01980000-0000-7000-8000-000000000001', 'lisbon', 'Lisbon', 'PT', 38.7223, -9.1393, 25),
  ('01980000-0000-7000-8000-000000000002', 'lagos', 'Lagos', 'NG', 6.4281, 3.4219, 25),
  ('01980000-0000-7000-8000-000000000003', 'cape-town', 'Cape Town', 'ZA', -33.9249, 18.4241, 25),
  ('01980000-0000-7000-8000-000000000004', 'zanzibar', 'Zanzibar', 'TZ', -6.1659, 39.2026, 25),
  ('01980000-0000-7000-8000-000000000005', 'paris', 'Paris', 'FR', 48.8566, 2.3522, 25),
  ('01980000-0000-7000-8000-000000000006', 'new-york', 'New York', 'US', 40.7128, -74.006, 25),
  ('01980000-0000-7000-8000-000000000007', 'bali', 'Bali (Seminyak)', 'ID', -8.6913, 115.1682, 25),
  ('01980000-0000-7000-8000-000000000008', 'marrakech', 'Marrakech', 'MA', 31.6295, -7.9811, 25);

CREATE TABLE catalog.properties (
  id            uuid PRIMARY KEY,
  name          text NOT NULL,
  brand         text,
  star_rating   numeric(2, 1) NOT NULL,
  address       text NOT NULL,
  city          text NOT NULL,
  country_code  char(2) NOT NULL,
  lat           double precision NOT NULL,
  lng           double precision NOT NULL,
  amenities     text[] NOT NULL DEFAULT '{}',
  description   text NOT NULL DEFAULT '',
  photos        jsonb NOT NULL DEFAULT '[]',
  shared_id     text UNIQUE,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX properties_geo_idx ON catalog.properties (lat, lng);
CREATE INDEX properties_name_idx ON catalog.properties USING gin (name gin_trgm_ops);
CREATE INDEX properties_amenities_idx ON catalog.properties USING gin (amenities);

-- Which supplier record maps to which property (one property, many sources).
CREATE TABLE catalog.property_sources (
  supplier              text NOT NULL,
  supplier_property_id  text NOT NULL,
  property_id           uuid NOT NULL REFERENCES catalog.properties (id),
  name                  text NOT NULL,
  match_reason          text NOT NULL CHECK (match_reason IN ('new', 'shared_id', 'location_and_name')),
  content               jsonb NOT NULL,
  last_seen_at          timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (supplier, supplier_property_id)
);
CREATE INDEX property_sources_property_idx ON catalog.property_sources (property_id);

CREATE TABLE catalog.ingestion_runs (
  id           uuid PRIMARY KEY,
  supplier     text NOT NULL,
  started_at   timestamptz NOT NULL DEFAULT now(),
  finished_at  timestamptz,
  status       text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  created      integer NOT NULL DEFAULT 0,
  merged       integer NOT NULL DEFAULT 0,
  updated      integer NOT NULL DEFAULT 0,
  error        text
);

-- Projection of Partners' programs (Catalog may not call Partners: same layer). Kept from events.
CREATE TABLE catalog.partner_programs (
  program_id    uuid PRIMARY KEY,
  name          text NOT NULL,
  tier          text NOT NULL,
  active        boolean NOT NULL,
  property_ids  uuid[] NOT NULL,
  perks         jsonb NOT NULL,
  rate_codes    text[] NOT NULL,
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX partner_programs_properties_idx ON catalog.partner_programs USING gin (property_ids);
