import { MODULES, PLATFORM, moduleRole } from '../modules.js';

const ident = (s: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(s)) throw new Error(`Unsafe identifier: ${s}`);
  return s;
};
const literal = (s: string) => `'${s.replace(/'/g, "''")}'`;

/**
 * Idempotent bootstrap run by the migration runner as the database superuser:
 * extensions, roles, one schema per module (owned by that module's role), and platform tables.
 */
export function bootstrapSql(appUser: string, appPassword: string): string {
  const moduleNames = [PLATFORM, ...MODULES.filter((m) => m.schemas.length > 0).map((m) => m.name)];
  const roleStatements = moduleNames
    .map((name) => {
      const role = ident(moduleRole(name));
      return `
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = '${role}') THEN
    CREATE ROLE ${role} NOLOGIN INHERIT;
  END IF;
END $$;
GRANT atp_modules TO ${role};
GRANT ${role} TO ${ident(appUser)};`;
    })
    .join('\n');

  const schemaStatements = MODULES.flatMap((m) =>
    m.schemas.map((schema) => {
      const role = ident(moduleRole(m.name));
      return `
CREATE SCHEMA IF NOT EXISTS ${ident(schema)} AUTHORIZATION ${role};
ALTER SCHEMA ${ident(schema)} OWNER TO ${role};
REVOKE ALL ON SCHEMA ${ident(schema)} FROM PUBLIC;`;
    }),
  ).join('\n');

  return `
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS citext;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'atp_modules') THEN
    CREATE ROLE atp_modules NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = ${literal(appUser)}) THEN
    CREATE ROLE ${ident(appUser)} LOGIN NOINHERIT PASSWORD ${literal(appPassword)};
  END IF;
END $$;
-- The login role holds no table privileges itself: it must SET ROLE to a module role.
ALTER ROLE ${ident(appUser)} NOINHERIT;

REVOKE CREATE ON SCHEMA public FROM PUBLIC;
${roleStatements}

CREATE SCHEMA IF NOT EXISTS platform AUTHORIZATION ${moduleRole(PLATFORM)};
ALTER SCHEMA platform OWNER TO ${moduleRole(PLATFORM)};
REVOKE ALL ON SCHEMA platform FROM PUBLIC;
GRANT USAGE ON SCHEMA platform TO atp_modules;
${schemaStatements}

SET ROLE ${moduleRole(PLATFORM)};

CREATE TABLE IF NOT EXISTS platform.schema_migrations (
  module      text NOT NULL,
  name        text NOT NULL,
  checksum    text NOT NULL,
  applied_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (module, name)
);

-- Transactional outbox (ADR-03). Written by any module in its own transaction; relayed after commit.
CREATE TABLE IF NOT EXISTS platform.outbox (
  seq             bigserial PRIMARY KEY,
  id              uuid NOT NULL UNIQUE,
  type            text NOT NULL,
  version         integer NOT NULL,
  producer        text NOT NULL,
  payload         jsonb NOT NULL,
  correlation_id  text,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  relayed_at      timestamptz
);
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON platform.outbox (seq) WHERE relayed_at IS NULL;
GRANT INSERT ON platform.outbox TO atp_modules;
GRANT USAGE ON SEQUENCE platform.outbox_seq_seq TO atp_modules;

-- Handler de-duplication: delivery is at-least-once, so each (event, handler) is processed once.
CREATE TABLE IF NOT EXISTS platform.processed_events (
  event_id      uuid NOT NULL,
  handler       text NOT NULL,
  processed_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, handler)
);
GRANT SELECT, INSERT ON platform.processed_events TO atp_modules;

-- Idempotency-Key storage for state-changing HTTP requests.
CREATE TABLE IF NOT EXISTS platform.idempotency_keys (
  scope            text NOT NULL,
  key              text NOT NULL,
  request_hash     text NOT NULL,
  status           text NOT NULL CHECK (status IN ('in_progress', 'completed')),
  response_status  integer,
  response_body    jsonb,
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  PRIMARY KEY (scope, key)
);
CREATE INDEX IF NOT EXISTS idempotency_keys_expiry_idx ON platform.idempotency_keys (expires_at);

-- Inbound provider webhooks: stored raw, de-duplicated by provider event id, processed asynchronously.
CREATE TABLE IF NOT EXISTS platform.webhook_inbox (
  id            uuid PRIMARY KEY,
  provider      text NOT NULL,
  event_id      text NOT NULL,
  event_type    text NOT NULL,
  payload       jsonb NOT NULL,
  raw_body      text NOT NULL,
  received_at   timestamptz NOT NULL DEFAULT now(),
  processed_at  timestamptz,
  UNIQUE (provider, event_id)
);

-- Feature flags and kill switches (FR-ADM-04): changed by admins without a deploy, read by every module.
CREATE TABLE IF NOT EXISTS platform.feature_flags (
  key          text PRIMARY KEY,
  enabled      boolean NOT NULL DEFAULT true,
  description  text NOT NULL,
  updated_by   uuid,
  updated_at   timestamptz NOT NULL DEFAULT now()
);
INSERT INTO platform.feature_flags (key, enabled, description) VALUES
  ('new_bookings', true, 'Travelers can start new bookings. Turn off to pause checkout during a supplier or payment incident.'),
  ('ai_assistant', true, 'The advisor AI assistant is available. Turn off to disable it for everyone.')
ON CONFLICT (key) DO NOTHING;
GRANT SELECT ON platform.feature_flags TO atp_modules;

RESET ROLE;
`;
}

/** Grants that let modules enqueue jobs in their own transaction and let the runner work. */
export function graphileWorkerGrantsSql(appUser: string): string {
  const grantees = `atp_modules, ${ident(appUser)}`;
  return `
GRANT USAGE ON SCHEMA graphile_worker TO ${grantees};
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA graphile_worker TO ${grantees};
GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA graphile_worker TO ${grantees};
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA graphile_worker TO ${grantees};
-- graphile-worker enables row-level security on its private tables with no policies, so only the owner
-- could see jobs. Allow our app and module roles explicitly.
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT c.relname FROM pg_class c
            WHERE c.relnamespace = 'graphile_worker'::regnamespace AND c.relkind = 'r' AND c.relrowsecurity
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS atp_access ON graphile_worker.%I', t);
    EXECUTE format('CREATE POLICY atp_access ON graphile_worker.%I TO ${grantees} USING (true) WITH CHECK (true)', t);
  END LOOP;
END $$;
`;
}
