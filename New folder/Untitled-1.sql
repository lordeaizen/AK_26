-- Stage 2: Glitched Workshop
-- Columns match the spec exactly. Do not rename.

CREATE TABLE IF NOT EXISTS workshop_attempts (
  attempt_id                            TEXT PRIMARY KEY,
  session_id                            TEXT NOT NULL,
  block_number                          INTEGER NOT NULL CHECK (block_number IN (1, 2, 3)),
  method_signature                      TEXT NOT NULL,
  strategy_change                       INTEGER NOT NULL DEFAULT 0 CHECK (strategy_change IN (0, 1)),
  clue_requested                        INTEGER NOT NULL DEFAULT 0 CHECK (clue_requested IN (0, 1)),
  clue_cost                             INTEGER NOT NULL DEFAULT 0,
  errors_count                          INTEGER NOT NULL DEFAULT 0,
  time_spent_ms                         INTEGER NOT NULL DEFAULT 0,
  outcome                               TEXT NOT NULL
    CHECK (outcome IN ('solved', 'skipped', 'ended_session', 'break_taken', 'failed')),
  reaction_time_after_prior_failure_ms  INTEGER,
  recorded_at                           TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_workshop_attempts_session
  ON workshop_attempts (session_id, block_number);

CREATE TABLE IF NOT EXISTS frustration_ratings (
  rating_id    TEXT PRIMARY KEY,
  session_id   TEXT NOT NULL,
  timing       TEXT NOT NULL CHECK (timing IN ('pre', 'post')),
  value        INTEGER NOT NULL CHECK (value BETWEEN 1 AND 5),
  recorded_at  TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (session_id, timing),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

-- Server-authoritative per-block state. Prevents skip/complete from advancing
-- without a valid session state, and stores the assigned puzzle config + solution
-- (solution is NEVER sent to the participant).
CREATE TABLE IF NOT EXISTS workshop_block_state (
  session_id     TEXT NOT NULL,
  block_number   INTEGER NOT NULL CHECK (block_number IN (1, 2, 3)),
  puzzle_config  TEXT NOT NULL,   -- JSON, participant-safe portion
  puzzle_secret  TEXT NOT NULL,   -- JSON, solution + clue ladder. Server-only.
  status         TEXT NOT NULL DEFAULT 'assigned'
    CHECK (status IN ('assigned', 'in_progress', 'complete')),
  outcome        TEXT,
  started_at     TEXT,
  ended_at       TEXT,
  PRIMARY KEY (session_id, block_number),
  FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

-- Point balance used for clue costs, validated server-side only.
ALTER TABLE sessions ADD COLUMN points_balance INTEGER NOT NULL DEFAULT 100;