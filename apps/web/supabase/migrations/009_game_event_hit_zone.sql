-- ═══════════════════════════════════════════════════════════════════════
-- 009: Add hit_zone to game_events
-- ═══════════════════════════════════════════════════════════════════════
-- Records the coarse direction a batted ball was hit, so the 2D playback
-- can place the ball in a believable spot (and pick the right fielder).
-- Values are: LF_LINE, LF, LCF, CF, RCF, RF, RF_LINE, INFIELD.
-- Null for non-batted-ball events (Walks and Strikeouts).
-- ═══════════════════════════════════════════════════════════════════════

alter table public.game_events
  add column if not exists hit_zone text;
