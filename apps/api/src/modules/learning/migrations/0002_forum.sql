-- Community forum (FR-CMT-01): topics, replies, full-text search, abuse reports, moderation.

CREATE TABLE learning.forum_categories (
  id           uuid PRIMARY KEY,
  slug         text NOT NULL UNIQUE,
  name         text NOT NULL,
  description  text NOT NULL,
  position     integer NOT NULL
);

INSERT INTO learning.forum_categories (id, slug, name, description, position) VALUES
  ('01970000-0000-7000-8000-000000000f01', 'general', 'General', 'Introductions and anything else.', 1),
  ('01970000-0000-7000-8000-000000000f02', 'bookings-suppliers', 'Bookings and suppliers', 'Hotels, rates, perks and booking questions.', 2),
  ('01970000-0000-7000-8000-000000000f03', 'destinations', 'Destinations', 'Tips and recommendations by place.', 3),
  ('01970000-0000-7000-8000-000000000f04', 'growing-your-business', 'Growing your business', 'Finding clients, marketing and pricing your service.', 4),
  ('01970000-0000-7000-8000-000000000f05', 'platform-help', 'Platform help', 'How to use the platform. Staff answer here.', 5);

CREATE TABLE learning.forum_topics (
  id                uuid PRIMARY KEY,
  category_id       uuid NOT NULL REFERENCES learning.forum_categories (id),
  author_user_id    uuid NOT NULL,
  author_name       text NOT NULL,           -- snapshot at posting time
  title             text NOT NULL,
  body              text NOT NULL,
  locked            boolean NOT NULL DEFAULT false,
  hidden            boolean NOT NULL DEFAULT false,
  hidden_reason     text,
  reply_count       integer NOT NULL DEFAULT 0,
  last_activity_at  timestamptz NOT NULL DEFAULT now(),
  created_at        timestamptz NOT NULL DEFAULT now(),
  edited_at         timestamptz,
  search            tsvector GENERATED ALWAYS AS
                      (setweight(to_tsvector('english', title), 'A') || setweight(to_tsvector('english', body), 'B')) STORED
);
CREATE INDEX forum_topics_category_idx ON learning.forum_topics (category_id, last_activity_at DESC, id);
CREATE INDEX forum_topics_activity_idx ON learning.forum_topics (last_activity_at DESC, id);
CREATE INDEX forum_topics_search_idx ON learning.forum_topics USING gin (search);

CREATE TABLE learning.forum_posts (
  id              uuid PRIMARY KEY,
  topic_id        uuid NOT NULL REFERENCES learning.forum_topics (id),
  author_user_id  uuid NOT NULL,
  author_name     text NOT NULL,
  body            text NOT NULL,
  hidden          boolean NOT NULL DEFAULT false,
  hidden_reason   text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  edited_at       timestamptz,
  search          tsvector GENERATED ALWAYS AS (to_tsvector('english', body)) STORED
);
CREATE INDEX forum_posts_topic_idx ON learning.forum_posts (topic_id, created_at, id);
CREATE INDEX forum_posts_search_idx ON learning.forum_posts USING gin (search);

CREATE TABLE learning.forum_reports (
  id                uuid PRIMARY KEY,
  target_type       text NOT NULL CHECK (target_type IN ('topic', 'post')),
  target_id         uuid NOT NULL,
  reporter_user_id  uuid NOT NULL,
  reason            text NOT NULL,
  status            text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'dismissed', 'actioned')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  resolved_by       uuid,
  resolved_at       timestamptz,
  UNIQUE (target_type, target_id, reporter_user_id)
);
CREATE INDEX forum_reports_open_idx ON learning.forum_reports (created_at) WHERE status = 'open';
