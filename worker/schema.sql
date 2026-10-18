-- D1 schema for Describle's shared daily leaderboard (worker/src/index.js).
-- The browser sends each attempt (day, board, attempt number, the description, the model's top 5 and the secret
-- word's place); the worker checks it against the day's rules and works out the score. The description itself is
-- never stored. The live database was made from an older version of this file: changes since go in migrations/.
--
-- is_late, on every table: 0 = the first go on the day, 1 = played later (after the day), 2 = replays on the day.

CREATE TABLE IF NOT EXISTS players (
  id         TEXT PRIMARY KEY,   -- server-generated UUID
  token_hash TEXT NOT NULL,      -- SHA-256 of a server-issued session token
  created_at TEXT NOT NULL
);

-- One row per (player, day, board, run, attempt). Insert-only: the first submission of an attempt counts.
CREATE TABLE IF NOT EXISTS attempts (
  id           TEXT PRIMARY KEY,
  player_id    TEXT NOT NULL REFERENCES players (id),
  day_key      TEXT NOT NULL,                       -- puzzle's UTC day, YYYY-MM-DD
  is_late      INTEGER NOT NULL DEFAULT 0,
  attempt      INTEGER NOT NULL CHECK (attempt >= 0 AND attempt < 3),
  words        INTEGER NOT NULL CHECK (words >= 1 AND words <= 25),
  rank         INTEGER NOT NULL CHECK (rank >= 0 AND rank <= 5),   -- the secret word's place in the top 5 (0 = not there)
  points       INTEGER NOT NULL CHECK (points >= 0 AND points <= 100),
  submitted_at TEXT NOT NULL,
  run          INTEGER NOT NULL DEFAULT 0,          -- which go on that board (0 on the first-go board)
  place        INTEGER                              -- the secret word's place among all the words (null before 0002)
);
CREATE UNIQUE INDEX IF NOT EXISTS attempts_player_run ON attempts (player_id, day_key, is_late, run, attempt);

-- One row per go (run) of a player at a day on a board.
CREATE TABLE IF NOT EXISTS runs (
  player_id   TEXT NOT NULL,
  day_key     TEXT NOT NULL,
  is_late     INTEGER NOT NULL,
  run         INTEGER NOT NULL,
  attempts    INTEGER NOT NULL,
  points      INTEGER NOT NULL,   -- rules 2: the attempts' points added up; rules 1: the run's score
  best_points INTEGER NOT NULL,   -- the best single attempt's points
  score       REAL NOT NULL,      -- the run's score so far
  solved      INTEGER NOT NULL,
  finished    INTEGER NOT NULL,
  words       INTEGER,            -- words in the best (rules 2) or winning (rules 1) attempt
  ranks       TEXT NOT NULL,      -- comma-separated, per attempt: rank in the top 5 (rules 1) or place (rules 2)
  last_at     TEXT NOT NULL,
  PRIMARY KEY (player_id, day_key, is_late, run)
);

-- One row per player per day/board: their best run on it. Made at the first attempt (the jacob.gg hub counts plays
-- from this table: jacob.gg/worker/src/sources.js). A leaderboard view reads ~20 rows (D1 free plan: 5M rows read/day).
CREATE TABLE IF NOT EXISTS totals (
  player_id    TEXT NOT NULL,
  day_key      TEXT NOT NULL,
  is_late      INTEGER NOT NULL,
  display_name TEXT NOT NULL,
  score        INTEGER NOT NULL,     -- the best run's score (rules 2: one decimal)
  solved       INTEGER NOT NULL,
  finished     INTEGER NOT NULL,     -- the best run is over
  attempts     INTEGER NOT NULL,
  words        INTEGER,              -- words in the best run's winning/best description
  ranks        TEXT NOT NULL,        -- the best run's ranks/places, in order
  last_at      TEXT NOT NULL,
  runs         INTEGER NOT NULL DEFAULT 1,   -- goes on this board
  best_run     INTEGER NOT NULL DEFAULT 0,
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
