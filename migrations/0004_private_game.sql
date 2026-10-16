-- Private game schema for D1. Apply before Worker schema initialization.
-- ECS uses the Worker idempotent schema initializer and does not run D1 migrations.
ALTER TABLE friendships ADD COLUMN relationship_type TEXT NOT NULL DEFAULT 'friend';

CREATE TABLE IF NOT EXISTS room_socket_tickets (
  ticket_hash TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  room_code TEXT NOT NULL,
  role TEXT NOT NULL,
  session_id TEXT NOT NULL DEFAULT '',
  join_ticket TEXT NOT NULL DEFAULT '',
  expires_at INTEGER NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_room_socket_tickets_expiry ON room_socket_tickets(expires_at, used);