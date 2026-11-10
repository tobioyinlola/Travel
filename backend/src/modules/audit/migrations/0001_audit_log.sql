-- Append-only audit trail (FR-AUTH-09, NFR-12). Partitioned by month (ARCH "Patterns we use").
CREATE TABLE audit.log (
  id              uuid        NOT NULL,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  actor_id        uuid,
  actor_type      text        NOT NULL CHECK (actor_type IN ('user', 'system', 'support', 'provider')),
  action          text        NOT NULL,
  entity_type     text        NOT NULL,
  entity_id       text        NOT NULL,
  module          text        NOT NULL,
  before          jsonb,
  after           jsonb,
  correlation_id  text,
  metadata        jsonb,
  PRIMARY KEY (id, occurred_at)
) PARTITION BY RANGE (occurred_at);

CREATE TABLE audit.log_default PARTITION OF audit.log DEFAULT;
CREATE INDEX log_entity_idx ON audit.log (entity_type, entity_id, occurred_at DESC);
CREATE INDEX log_actor_idx ON audit.log (actor_id, occurred_at DESC);

-- Creates monthly partitions from the current month to `months_ahead` months out.
CREATE FUNCTION audit.ensure_partitions(months_ahead integer DEFAULT 3) RETURNS void
LANGUAGE plpgsql AS $$
DECLARE
  m date := date_trunc('month', now() AT TIME ZONE 'UTC')::date;
  name text;
BEGIN
  FOR i IN 0..months_ahead LOOP
    name := format('log_%s', to_char(m, 'YYYY_MM'));
    IF to_regclass(format('audit.%I', name)) IS NULL THEN
      EXECUTE format(
        'CREATE TABLE audit.%I PARTITION OF audit.log FOR VALUES FROM (%L) TO (%L)',
        name, m::timestamptz, (m + interval '1 month')::timestamptz);
    END IF;
    m := (m + interval '1 month')::date;
  END LOOP;
END $$;

SELECT audit.ensure_partitions(3);

-- Nobody, including the owning role, may change or remove history.
CREATE FUNCTION audit.reject_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit.log is append-only (% blocked)', TG_OP USING ERRCODE = 'insufficient_privilege';
END $$;

CREATE TRIGGER log_no_update_delete BEFORE UPDATE OR DELETE ON audit.log
  FOR EACH ROW EXECUTE FUNCTION audit.reject_mutation();
CREATE TRIGGER log_no_truncate BEFORE TRUNCATE ON audit.log
  FOR EACH STATEMENT EXECUTE FUNCTION audit.reject_mutation();

-- Any module may append (inside its own transaction); none may read except the audit role.
GRANT USAGE ON SCHEMA audit TO atp_modules;
GRANT INSERT ON audit.log TO atp_modules;
