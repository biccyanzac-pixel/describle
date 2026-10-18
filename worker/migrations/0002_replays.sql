-- Replays and places (Oct 2026): any number of goes at a day on the replay boards, and the secret word's place among
-- all the words for every attempt. Run on the live database BEFORE deploying the worker that needs it:
--   cd worker && npx wrangler d1 export describle-leaderboard --remote --output=../backups/describle-<date>.sql
--   npx wrangler d1 execute describle-leaderboard --remote --file=migrations/0002_replays.sql
-- totals keeps its rows and rowids (the jacob.gg hub syncs it by rowid).

ALTER TABLE attempts ADD COLUMN run INTEGER NOT NULL DEFAULT 0;
ALTER TABLE attempts ADD COLUMN place INTEGER;
DROP INDEX IF EXISTS attempts_player;
CREATE UNIQUE INDEX IF NOT EXISTS attempts_player_run ON attempts (player_id, day_key, is_late, run, attempt);

CREATE TABLE IF NOT EXISTS runs (
  player_id   TEXT NOT NULL,
  day_key     TEXT NOT NULL,
  is_late     INTEGER NOT NULL,
  run         INTEGER NOT NULL,
  attempts    INTEGER NOT NULL,
  points      INTEGER NOT NULL,
  best_points INTEGER NOT NULL,
  score       REAL NOT NULL,
  solved      INTEGER NOT NULL,
  finished    INTEGER NOT NULL,
  words       INTEGER,
  ranks       TEXT NOT NULL,
  last_at     TEXT NOT NULL,
  PRIMARY KEY (player_id, day_key, is_late, run)
);
-- Every existing board row was one run.
INSERT OR IGNORE INTO runs (player_id, day_key, is_late, run, attempts, points, best_points, score, solved, finished, words, ranks, last_at)
  SELECT player_id, day_key, is_late, 0, attempts, score, score, score, solved, finished, words, ranks, last_at FROM totals;

ALTER TABLE totals ADD COLUMN runs INTEGER NOT NULL DEFAULT 1;
ALTER TABLE totals ADD COLUMN best_run INTEGER NOT NULL DEFAULT 0;
