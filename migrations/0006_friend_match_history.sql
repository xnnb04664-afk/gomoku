-- Keep a lightweight, friendship-gated summary archive for every saved game.
-- Full replay payloads remain in game_history and keep their existing retention policy.
CREATE TABLE IF NOT EXISTS friend_match_history (
  history_id INTEGER PRIMARY KEY,
  uid TEXT NOT NULL,
  mode TEXT NOT NULL,
  is_win INTEGER NOT NULL,
  is_draw INTEGER NOT NULL DEFAULT 0,
  winner_color INTEGER NOT NULL DEFAULT 0,
  opp_name TEXT,
  moves_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_friend_match_history_uid_id
  ON friend_match_history(uid, history_id DESC);

INSERT OR IGNORE INTO friend_match_history (
  history_id, uid, mode, is_win, is_draw, winner_color, opp_name, moves_count, created_at
)
SELECT id, uid, mode, is_win, is_draw, winner_color, opp_name, moves_count, created_at
FROM game_history;

CREATE TRIGGER IF NOT EXISTS trg_game_history_friend_match_insert
AFTER INSERT ON game_history
BEGIN
  INSERT OR IGNORE INTO friend_match_history (
    history_id, uid, mode, is_win, is_draw, winner_color, opp_name, moves_count, created_at
  ) VALUES (
    NEW.id, NEW.uid, NEW.mode, NEW.is_win, COALESCE(NEW.is_draw, 0),
    NEW.winner_color, NEW.opp_name, NEW.moves_count, COALESCE(NEW.created_at, CURRENT_TIMESTAMP)
  );
END;
