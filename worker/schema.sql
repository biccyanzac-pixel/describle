-- D1 schema for Describle's shared daily leaderboard (worker/src/index.js).
-- The browser sends each attempt (day, attempt number, the description, the model's top 5); the worker checks it
-- against the day's rules and works out the score. The description itself is never stored.

CREATE TABLE IF NOT EXISTS players (
  id         TEXT PRIMARY KEY,   -- server-generated UUID
  token_hash TEXT NOT NULL,      -- SHA-256 of a server-issued session token
  created_at TEXT NOT NULL
);

-- One row per (player, day, board, attempt). Insert-only: the first submission of an attempt counts.
CREATE TABLE IF NOT EXISTS attempts (
  id           TEXT PRIMARY KEY,
  player_id    TEXT NOT NULL REFERENCES players (id),
  day_key      TEXT NOT NULL,                       -- puzzle's UTC day, YYYY-MM-DD
  is_late      INTEGER NOT NULL DEFAULT 0,          -- 1 = played from the archive after its day
  attempt      INTEGER NOT NULL CHECK (attempt >= 0 AND attempt < 3),
  words        INTEGER NOT NULL CHECK (words >= 1 AND words <= 25),
  rank         INTEGER NOT NULL CHECK (rank >= 0 AND rank <= 5),   -- the secret word's place in the top 5 (0 = not there)
  points       INTEGER NOT NULL CHECK (points >= 0 AND points <= 100),
  submitted_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS attempts_player ON attempts (player_id, day_key, is_late, attempt);

-- One row per player per day/board, made at the first attempt (the jacob.gg hub counts plays from this table:
-- jacob.gg/worker/src/sources.js). A leaderboard view reads ~20 rows (D1 free plan: 5M rows read/day).
CREATE TABLE IF NOT EXISTS totals (
  player_id    TEXT NOT NULL,
  day_key      TEXT NOT NULL,
  is_late      INTEGER NOT NULL,
  display_name TEXT NOT NULL,
  score        INTEGER NOT NULL,     -- the day's score so far (0 until guessed)
  solved       INTEGER NOT NULL,
  finished     INTEGER NOT NULL,     -- guessed, or 3 attempts used
  attempts     INTEGER NOT NULL,
  words        INTEGER,              -- words in the winning description
  ranks        TEXT NOT NULL,        -- comma-separated rank per attempt, in order
  last_at      TEXT NOT NULL,
  PRIMARY KEY (player_id, day_key, is_late)
);
CREATE INDEX IF NOT EXISTS totals_board ON totals (day_key, is_late, score DESC, last_at ASC);

-- Per-day counters for the board header and the archive list.
CREATE TABLE IF NOT EXISTS day_stats (
  day_key TEXT NOT NULL,
  is_late INTEGER NOT NULL,
  players INTEGER NOT NULL,
  top     INTEGER NOT NULL,
  PRIMARY KEY (day_key, is_late)
);
