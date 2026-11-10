-- Property and rate codes travel with each hotel so Partners can attach perks and Commission can find the rate.
ALTER TABLE booking.lines ADD COLUMN property_id uuid;
ALTER TABLE booking.lines ADD COLUMN rate_codes text[] NOT NULL DEFAULT '{}';
