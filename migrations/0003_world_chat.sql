-- World channel persistence and per-user read/view state.
-- Messages are retained in D1; the Worker exposes a bounded 30-day/5000-id history window.
CREATE TABLE IF NOT EXISTS world_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  channel TEXT NOT NULL DEFAULT 'world' CHECK(channel = 'world'),
  sender_uid TEXT NOT NULL,
  client_message_id TEXT NOT NULL,
  body TEXT NOT NULL,
  moderation_state TEXT NOT NULL DEFAULT 'visible' CHECK(moderation_state IN ('visible', 'hidden')),
  created_at INTEGER NOT NULL,
  UNIQUE(sender_uid, client_message_id)
);
CREATE INDEX IF NOT EXISTS idx_world_messages_channel_id ON world_messages(channel, id DESC);
CREATE INDEX IF NOT EXISTS idx_world_messages_sender_time ON world_messages(sender_uid, created_at DESC);
CREATE TABLE IF NOT EXISTS world_message_state (
  uid TEXT PRIMARY KEY,
  last_read_id INTEGER NOT NULL DEFAULT 0,
  cleared_before_id INTEGER NOT NULL DEFAULT 0
);
ALTER TABLE social_socket_tickets ADD COLUMN channel TEXT NOT NULL DEFAULT 'friends';
