-- Password reset (FR-AUTH-01 recovery). Only a hash of the emailed token is stored; a token works once and expires.
CREATE TABLE identity.password_resets (
  id          uuid PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES identity.users (id),
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_resets_open_idx ON identity.password_resets (user_id) WHERE used_at IS NULL;
