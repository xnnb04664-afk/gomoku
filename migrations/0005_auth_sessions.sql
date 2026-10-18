-- Store each device/browser login independently. Access and refresh secrets are
-- hashed in auth_sessions; the legacy users token columns remain for migration
-- and rollback compatibility.
CREATE TABLE IF NOT EXISTS auth_sessions (
  session_id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  access_token_hash TEXT NOT NULL UNIQUE,
  access_expires_at INTEGER NOT NULL DEFAULT 0,
  refresh_token_hash TEXT UNIQUE,
  refresh_expires_at INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  last_used_at INTEGER NOT NULL,
  revoked_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_uid_active
  ON auth_sessions(uid, revoked_at, access_expires_at);

CREATE INDEX IF NOT EXISTS idx_auth_sessions_uid_refresh
  ON auth_sessions(uid, refresh_token_hash, revoked_at);
