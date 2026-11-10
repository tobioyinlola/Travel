-- Seeds 10,000 active advisors, 50,000 clients and 20,000 trips for load testing (NFR-03). Development databases only.
-- Idempotent: rows are keyed by a deterministic uuid, so running it twice adds nothing. Run as a superuser:
--   psql "$DATABASE_ADMIN_URL" -f scripts/load-seed.sql
BEGIN;
SET LOCAL session_replication_role = replica; -- skip FK/RLS checks for bulk loading

INSERT INTO identity.users (id, email, display_name, password_hash, role, status)
SELECT ('00000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid, 'advisor' || g || '@load.test', 'Load Advisor ' || g, 'load-test-not-a-real-hash', 'advisor', 'active'
  FROM generate_series(1, 10000) g
ON CONFLICT DO NOTHING;

INSERT INTO identity.advisors (id, user_id, status, legal_name, country, address, tax_residency, experience, niche, submitted_at)
SELECT ('00000000-0000-4001-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       ('00000000-0000-4000-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       'active', 'Load Advisor ' || g, 'NG', '{"line1":"1 Load St","city":"Lagos"}', 'NG', 'some', 'Family travel',
       now() - (g % 365) * interval '1 day'
  FROM generate_series(1, 10000) g
ON CONFLICT DO NOTHING;

INSERT INTO clients.clients (id, owner_advisor_id, first_name, last_name, email, home_city, notes)
SELECT ('00000000-0000-4002-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       ('00000000-0000-4001-8000-' || lpad(to_hex(1 + (g % 10000)), 12, '0'))::uuid,
       'Client' || g, 'Load', 'client' || g || '@load.test', 'City ' || (g % 200), 'Likes quiet hotels. Note ' || g
  FROM generate_series(1, 50000) g
ON CONFLICT DO NOTHING;

INSERT INTO itineraries.trips (id, owner_advisor_id, client_id, title, start_date, end_date, adults, currency)
SELECT ('00000000-0000-4003-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       ('00000000-0000-4001-8000-' || lpad(to_hex(1 + (g % 10000)), 12, '0'))::uuid,
       ('00000000-0000-4002-8000-' || lpad(to_hex(g), 12, '0'))::uuid,
       'Trip ' || g, current_date + (g % 300), current_date + (g % 300) + 5, 2, 'USD'
  FROM generate_series(1, 20000) g
ON CONFLICT DO NOTHING;
COMMIT;
ANALYZE;
