-- A trip becomes 'booked' once Booking confirms every hotel (Sprint 4).
ALTER TABLE itineraries.trips DROP CONSTRAINT trips_status_check;
ALTER TABLE itineraries.trips ADD CONSTRAINT trips_status_check
  CHECK (status IN ('planning', 'proposed', 'approved', 'booked', 'cancelled'));
