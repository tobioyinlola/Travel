-- Notifications (FR-NTF-01, FR-NTF-05).

-- Contact details projected from Identity events (Notifications may not call Identity: same layer).
CREATE TABLE notifications.recipients (
  user_id       uuid PRIMARY KEY,
  email         text,
  phone         text,
  display_name  text,
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE notifications.messages (
  id           uuid PRIMARY KEY,
  event_id     uuid NOT NULL,
  template     text NOT NULL,
  user_id      uuid NOT NULL,
  channel      text NOT NULL CHECK (channel IN ('email', 'sms')),
  destination  text NOT NULL,
  subject      text NOT NULL,
  -- '[redacted]' for templates that carry secrets (one-time codes); the content travels only in the job.
  body_text    text NOT NULL,
  status       text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'sent', 'failed', 'skipped')),
  provider_ref text,
  error        text,
  created_at   timestamptz NOT NULL DEFAULT now(),
  sent_at      timestamptz,
  -- FR-NTF-05: one message per event, template and recipient, however often the event is delivered.
  UNIQUE (event_id, template, user_id)
);
CREATE INDEX messages_user_idx ON notifications.messages (user_id, created_at DESC);
