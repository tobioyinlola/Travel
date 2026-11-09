-- Travelers receive proposals without having an account: messages may go to an address with no user.
ALTER TABLE notifications.messages ALTER COLUMN user_id DROP NOT NULL;
ALTER TABLE notifications.messages DROP CONSTRAINT messages_event_id_template_user_id_key;
CREATE UNIQUE INDEX messages_once_per_event ON notifications.messages (event_id, template, coalesce(user_id::text, destination));
