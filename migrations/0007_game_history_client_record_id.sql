-- Optional client-generated id makes a saved game safe to retry after a timeout.
-- NULL remains valid for older clients; SQLite permits multiple NULLs in a unique index.
ALTER TABLE game_history ADD COLUMN client_record_id TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_game_history_uid_client_record_id
  ON game_history(uid, client_record_id);

-- Keep the acknowledgement after full replay rows are trimmed or users clear
-- their visible cloud history, so a delayed retry cannot recreate the game.
CREATE TABLE IF NOT EXISTS game_history_upload_receipts (
  uid TEXT NOT NULL,
  client_record_id TEXT NOT NULL,
  history_id INTEGER NOT NULL,
  PRIMARY KEY(uid, client_record_id)
);

INSERT OR IGNORE INTO game_history_upload_receipts (uid, client_record_id, history_id)
SELECT uid, client_record_id, id FROM game_history
WHERE client_record_id IS NOT NULL AND client_record_id <> '';

CREATE TRIGGER IF NOT EXISTS trg_game_history_upload_receipt_insert
AFTER INSERT ON game_history
WHEN NEW.client_record_id IS NOT NULL AND NEW.client_record_id <> ''
BEGIN
  INSERT OR IGNORE INTO game_history_upload_receipts (uid, client_record_id, history_id)
  VALUES (NEW.uid, NEW.client_record_id, NEW.id);
END;
