-- Migration 013: Add game-day roster snapshot columns for deterministic replay.
-- Stores frozen player skills at the time the game was simulated, so
-- replays can re-simulate with the tick engine using exact game-day data
-- even after players are traded, trained, or retired.

ALTER TABLE games
  ADD COLUMN IF NOT EXISTS home_roster_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS visitor_roster_snapshot JSONB;
