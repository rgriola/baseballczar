-- Migration 017: Stats table rename + analytics/fielding columns
-- Part 1: Rename tables and add new columns

-- ═══════════════════════════════════════════════════════════════
-- 1. RENAME TABLES
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.game_stats_hitting RENAME TO hitter_game_stats;
ALTER TABLE public.game_stats_pitching RENAME TO pitcher_game_stats;
ALTER TABLE public.player_stats_hitting RENAME TO hitter_season_stats;
ALTER TABLE public.player_stats_pitching RENAME TO pitcher_season_stats;

-- ═══════════════════════════════════════════════════════════════
-- 2. ADD COLUMNS — hitter_game_stats
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.hitter_game_stats
  ADD COLUMN IF NOT EXISTS pa            int  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS putouts       int  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assists       int  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS errors        int  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_balls  int  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_ev      real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_la      real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_spray   real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_bat_speed real NOT NULL DEFAULT 0;

-- ═══════════════════════════════════════════════════════════════
-- 3. ADD COLUMNS — pitcher_game_stats
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.pitcher_game_stats
  ADD COLUMN IF NOT EXISTS pitches   int  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_mph real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS putouts   int  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assists   int  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS errors    int  NOT NULL DEFAULT 0;

-- ═══════════════════════════════════════════════════════════════
-- 4. ADD COLUMNS — hitter_season_stats + league_id
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.hitter_season_stats
  ADD COLUMN IF NOT EXISTS league_id      bigint REFERENCES public.leagues(id),
  ADD COLUMN IF NOT EXISTS pa             int  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS putouts        int  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assists        int  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS errors         int  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS batted_balls   int  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_ev       real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_la       real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_spray    real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_bat_speed real NOT NULL DEFAULT 0;

-- Update unique constraint to include league_id
ALTER TABLE public.hitter_season_stats
  DROP CONSTRAINT IF EXISTS player_stats_hitting_player_id_team_id_season_no_key;

ALTER TABLE public.hitter_season_stats
  ADD CONSTRAINT hitter_season_stats_unique
  UNIQUE (player_id, team_id, league_id, season_no);

-- ═══════════════════════════════════════════════════════════════
-- 5. ADD COLUMNS — pitcher_season_stats + league_id
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.pitcher_season_stats
  ADD COLUMN IF NOT EXISTS league_id  bigint REFERENCES public.leagues(id),
  ADD COLUMN IF NOT EXISTS pitches    int  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_mph  real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS putouts    int  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS assists    int  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS errors     int  NOT NULL DEFAULT 0;

ALTER TABLE public.pitcher_season_stats
  DROP CONSTRAINT IF EXISTS player_stats_pitching_player_id_team_id_season_no_key;

ALTER TABLE public.pitcher_season_stats
  ADD CONSTRAINT pitcher_season_stats_unique
  UNIQUE (player_id, team_id, league_id, season_no);

-- ═══════════════════════════════════════════════════════════════
-- 6. ADD PITCHING COLUMNS to standings
-- ═══════════════════════════════════════════════════════════════

ALTER TABLE public.standings
  ADD COLUMN IF NOT EXISTS p_ip  real NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS p_h   int  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS p_r   int  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS p_er  int  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS p_bb  int  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS p_so  int  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS p_hr  int  NOT NULL DEFAULT 0;

-- ═══════════════════════════════════════════════════════════════
-- 7. UPDATE game_type values
-- ═══════════════════════════════════════════════════════════════

-- Drop old CHECK on schedules
ALTER TABLE public.schedules DROP CONSTRAINT IF EXISTS schedules_game_type_check;
ALTER TABLE public.schedules
  ADD CONSTRAINT schedules_game_type_check
  CHECK (game_type IN ('League','Friendly','Tournament','regular','playoff','o2o'));

-- Update RLS policies that reference old table names
DROP POLICY IF EXISTS "gsh_read" ON public.hitter_game_stats;
CREATE POLICY "hitter_game_stats_read" ON public.hitter_game_stats FOR SELECT USING (true);

DROP POLICY IF EXISTS "gsp_read" ON public.pitcher_game_stats;
CREATE POLICY "pitcher_game_stats_read" ON public.pitcher_game_stats FOR SELECT USING (true);

DROP POLICY IF EXISTS "psh_read" ON public.hitter_season_stats;
CREATE POLICY "hitter_season_stats_read" ON public.hitter_season_stats FOR SELECT USING (true);

DROP POLICY IF EXISTS "psp_read" ON public.pitcher_season_stats;
CREATE POLICY "pitcher_season_stats_read" ON public.pitcher_season_stats FOR SELECT USING (true);
