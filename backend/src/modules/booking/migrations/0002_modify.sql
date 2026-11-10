-- Changing the lead guest on a confirmed booking (FR-BKG-05). Each hotel is told in its own job;
-- a line is up to date when its guest_version matches the booking's.
ALTER TABLE booking.bookings ADD COLUMN guest_version integer NOT NULL DEFAULT 1;
ALTER TABLE booking.lines ADD COLUMN guest_version integer NOT NULL DEFAULT 1;
ALTER TABLE booking.lines ADD COLUMN amend_failed boolean NOT NULL DEFAULT false;
