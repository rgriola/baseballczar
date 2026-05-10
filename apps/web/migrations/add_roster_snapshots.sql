-- Migration: Add roster snapshot columns to games table
-- Purpose: Store game-day player skills for deterministic replay re-simulation
-- Run this in the Supabase SQL Editor (Dashboard → SQL Editor → New query)

ALTER TABLE games
  ADD COLUMN IF NOT EXISTS home_roster_snapshot JSONB,
  ADD COLUMN IF NOT EXISTS visitor_roster_snapshot JSONB;

-- Verify
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'games'
  AND column_name IN ('home_roster_snapshot', 'visitor_roster_snapshot');
