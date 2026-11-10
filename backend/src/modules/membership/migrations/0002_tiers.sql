-- Split tiers (FR-MEM-05): the advisor's share of commission rises with calendar-year commissionable sales.
-- Thresholds and shares are data, so admins can change them without a deploy (FR-ADM-04). Values below are
-- placeholders to be confirmed by the business; the PRD fixes only the base 70/30 split and the $300K step.
CREATE TABLE membership.split_tiers (
  code              text PRIMARY KEY,
  name              text NOT NULL,
  position          integer NOT NULL UNIQUE,
  min_sales_minor   bigint NOT NULL CHECK (min_sales_minor >= 0),
  advisor_share_bps integer NOT NULL CHECK (advisor_share_bps BETWEEN 0 AND 10000),
  currency          char(3) NOT NULL DEFAULT 'USD'
);
INSERT INTO membership.split_tiers (code, name, position, min_sales_minor, advisor_share_bps) VALUES
  ('starter', 'Starter', 1, 0, 7000),
  ('pro', 'Pro', 2, 30000000, 7500),
  ('elite', 'Elite', 3, 75000000, 8000);

-- Running calendar-year total per advisor, built from commission events.
CREATE TABLE membership.advisor_sales (
  advisor_id           uuid NOT NULL,
  year                 integer NOT NULL,
  currency             char(3) NOT NULL,
  commissionable_minor bigint NOT NULL DEFAULT 0,
  tier_code            text NOT NULL REFERENCES membership.split_tiers (code),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (advisor_id, year)
);
