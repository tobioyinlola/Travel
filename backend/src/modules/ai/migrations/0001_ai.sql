-- AI assistant (FR-AI-01..08). Knowledge documents, drafts that need advisor approval, and a log of every
-- interaction. Advisor-owned rows use forced row-level security; shared documents (catalog, partners, course
-- content) have no owner and are visible to everyone, advisor documents (client notes) only to their owner (AC-10).

CREATE FUNCTION ai.visible(owner uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT current_setting('atp.scope', true) = 'all'
      OR owner = nullif(current_setting('atp.advisor_id', true), '')::uuid
$$;

CREATE TABLE ai.documents (
  id                uuid PRIMARY KEY,
  source_type       text NOT NULL CHECK (source_type IN ('catalog', 'partner', 'content', 'client')),
  source_ref        text NOT NULL,                 -- id of the thing in its own module
  owner_advisor_id  uuid,                          -- null: shared with every advisor
  title             text NOT NULL,
  body              text NOT NULL,                 -- sanitised: untrusted text has instruction-like lines removed
  flagged           integer NOT NULL DEFAULT 0,    -- lines removed by the injection filter
  content_hash      text NOT NULL,
  -- Embedding vector. pgvector is not available in every environment; at MVP scale similarity is computed in the
  -- application over the (small, owner-filtered) candidate set. Swap for a vector index when volumes need it.
  embedding         real[] NOT NULL,
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX documents_source_idx ON ai.documents
  (source_type, source_ref, coalesce(owner_advisor_id, '00000000-0000-0000-0000-000000000000'::uuid));
CREATE INDEX documents_owner_idx ON ai.documents (owner_advisor_id);
ALTER TABLE ai.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai.documents FORCE ROW LEVEL SECURITY;
CREATE POLICY shared_or_own ON ai.documents
  USING (owner_advisor_id IS NULL OR ai.visible(owner_advisor_id))
  WITH CHECK (current_setting('atp.scope', true) = 'all');

CREATE TABLE ai.interactions (
  id           uuid PRIMARY KEY,
  advisor_id   uuid NOT NULL,
  kind         text NOT NULL CHECK (kind IN ('ask', 'draft')),
  prompt       text NOT NULL,
  retrieved    jsonb NOT NULL DEFAULT '[]',        -- [{id, title, type, score}]
  tool_calls   jsonb NOT NULL DEFAULT '[]',        -- [{name, args, resultCount}]
  output       text NOT NULL,
  confidence   text NOT NULL CHECK (confidence IN ('high', 'medium', 'low')),
  flags        jsonb NOT NULL DEFAULT '[]',
  model        text NOT NULL,
  latency_ms   integer NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX interactions_advisor_idx ON ai.interactions (advisor_id, created_at DESC);

CREATE TABLE ai.drafts (
  id              uuid PRIMARY KEY,
  advisor_id      uuid NOT NULL,
  interaction_id  uuid NOT NULL REFERENCES ai.interactions (id) ON DELETE CASCADE,
  kind            text NOT NULL CHECK (kind IN ('client_message', 'trip_summary')),
  client_id       uuid,
  instruction     text NOT NULL,
  original_text   text NOT NULL,
  text            text NOT NULL,                   -- what the advisor approved (they may edit it)
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'approved', 'rejected')),
  sources         jsonb NOT NULL DEFAULT '[]',
  flags           jsonb NOT NULL DEFAULT '[]',
  created_at      timestamptz NOT NULL DEFAULT now(),
  decided_at      timestamptz
);
CREATE INDEX drafts_advisor_idx ON ai.drafts (advisor_id, created_at DESC);

CREATE TABLE ai.settings (
  advisor_id        uuid PRIMARY KEY,
  enabled           boolean NOT NULL DEFAULT true,
  use_client_notes  boolean NOT NULL DEFAULT true,
  updated_at        timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['interactions', 'drafts', 'settings'] LOOP
    EXECUTE format('ALTER TABLE ai.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('ALTER TABLE ai.%I FORCE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY advisor_owns ON ai.%I USING (ai.visible(advisor_id)) WITH CHECK (ai.visible(advisor_id))', t);
  END LOOP;
END $$;
