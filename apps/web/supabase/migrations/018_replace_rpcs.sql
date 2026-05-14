-- Migration 018: Replace RPCs for new table names + columns
-- Part 2: batch_upsert_season_hitting, batch_upsert_season_pitching, upsert_standing, persist_sim_game_transaction

-- ═══════════════════════════════════════════════════════════════
-- 1. REPLACE batch_upsert_season_hitting
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.batch_upsert_season_hitting(p_stats jsonb)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.hitter_season_stats
    (player_id, team_id, league_id, season_no,
     g, pa, ab, r, h, b2, b3, hr, rbi, bb, so, sb, cs,
     putouts, assists, errors,
     batted_balls, total_ev, total_la, total_spray, total_bat_speed)
  SELECT
    (s->>'player_id')::bigint,
    (s->>'team_id')::bigint,
    (s->>'league_id')::bigint,
    (s->>'season_no')::int,
    (s->>'g')::int,
    coalesce((s->>'pa')::int, 0),
    (s->>'ab')::int,
    (s->>'r')::int,
    (s->>'h')::int,
    (s->>'b2')::int,
    (s->>'b3')::int,
    (s->>'hr')::int,
    (s->>'rbi')::int,
    (s->>'bb')::int,
    (s->>'so')::int,
    coalesce((s->>'sb')::int, 0),
    coalesce((s->>'cs')::int, 0),
    coalesce((s->>'putouts')::int, 0),
    coalesce((s->>'assists')::int, 0),
    coalesce((s->>'errors')::int, 0),
    coalesce((s->>'batted_balls')::int, 0),
    coalesce((s->>'total_ev')::real, 0),
    coalesce((s->>'total_la')::real, 0),
    coalesce((s->>'total_spray')::real, 0),
    coalesce((s->>'total_bat_speed')::real, 0)
  FROM jsonb_array_elements(p_stats) AS s
  ON CONFLICT (player_id, team_id, league_id, season_no)
  DO UPDATE SET
    g              = hitter_season_stats.g              + excluded.g,
    pa             = hitter_season_stats.pa             + excluded.pa,
    ab             = hitter_season_stats.ab             + excluded.ab,
    r              = hitter_season_stats.r              + excluded.r,
    h              = hitter_season_stats.h              + excluded.h,
    b2             = hitter_season_stats.b2             + excluded.b2,
    b3             = hitter_season_stats.b3             + excluded.b3,
    hr             = hitter_season_stats.hr             + excluded.hr,
    rbi            = hitter_season_stats.rbi            + excluded.rbi,
    bb             = hitter_season_stats.bb             + excluded.bb,
    so             = hitter_season_stats.so             + excluded.so,
    sb             = hitter_season_stats.sb             + excluded.sb,
    cs             = hitter_season_stats.cs             + excluded.cs,
    putouts        = hitter_season_stats.putouts        + excluded.putouts,
    assists        = hitter_season_stats.assists        + excluded.assists,
    errors         = hitter_season_stats.errors         + excluded.errors,
    batted_balls   = hitter_season_stats.batted_balls   + excluded.batted_balls,
    total_ev       = hitter_season_stats.total_ev       + excluded.total_ev,
    total_la       = hitter_season_stats.total_la       + excluded.total_la,
    total_spray    = hitter_season_stats.total_spray    + excluded.total_spray,
    total_bat_speed = hitter_season_stats.total_bat_speed + excluded.total_bat_speed;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 2. REPLACE batch_upsert_season_pitching
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.batch_upsert_season_pitching(p_stats jsonb)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.pitcher_season_stats
    (player_id, team_id, league_id, season_no,
     w, l, g, gs, cg, sv, sho, ip, bf, h, r, er, bb, so, hr,
     pitches, total_mph, putouts, assists, errors)
  SELECT
    (s->>'player_id')::bigint,
    (s->>'team_id')::bigint,
    (s->>'league_id')::bigint,
    (s->>'season_no')::int,
    (s->>'w')::int,
    (s->>'l')::int,
    (s->>'g')::int,
    (s->>'gs')::int,
    (s->>'cg')::int,
    (s->>'sv')::int,
    (s->>'sho')::int,
    (s->>'ip')::real,
    (s->>'bf')::int,
    (s->>'h')::int,
    (s->>'r')::int,
    (s->>'er')::int,
    (s->>'bb')::int,
    (s->>'so')::int,
    (s->>'hr')::int,
    coalesce((s->>'pitches')::int, 0),
    coalesce((s->>'total_mph')::real, 0),
    coalesce((s->>'putouts')::int, 0),
    coalesce((s->>'assists')::int, 0),
    coalesce((s->>'errors')::int, 0)
  FROM jsonb_array_elements(p_stats) AS s
  ON CONFLICT (player_id, team_id, league_id, season_no)
  DO UPDATE SET
    w        = pitcher_season_stats.w        + excluded.w,
    l        = pitcher_season_stats.l        + excluded.l,
    g        = pitcher_season_stats.g        + excluded.g,
    gs       = pitcher_season_stats.gs       + excluded.gs,
    cg       = pitcher_season_stats.cg       + excluded.cg,
    sv       = pitcher_season_stats.sv       + excluded.sv,
    sho      = pitcher_season_stats.sho      + excluded.sho,
    ip       = public.add_ip(pitcher_season_stats.ip, excluded.ip),
    bf       = pitcher_season_stats.bf       + excluded.bf,
    h        = pitcher_season_stats.h        + excluded.h,
    r        = pitcher_season_stats.r        + excluded.r,
    er       = pitcher_season_stats.er       + excluded.er,
    bb       = pitcher_season_stats.bb       + excluded.bb,
    so       = pitcher_season_stats.so       + excluded.so,
    hr       = pitcher_season_stats.hr       + excluded.hr,
    pitches  = pitcher_season_stats.pitches  + excluded.pitches,
    total_mph = pitcher_season_stats.total_mph + excluded.total_mph,
    putouts  = pitcher_season_stats.putouts  + excluded.putouts,
    assists  = pitcher_season_stats.assists  + excluded.assists,
    errors   = pitcher_season_stats.errors   + excluded.errors;
END;
$$;

-- ═══════════════════════════════════════════════════════════════
-- 3. REPLACE upsert_standing (add pitching params)
-- ═══════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.upsert_standing(
  p_league_id  bigint,
  p_team_id    bigint,
  p_season_no  int,
  p_w          int,
  p_l          int,
  p_ab         int,
  p_r          int,
  p_h          int,
  p_b2         int,
  p_b3         int,
  p_hr         int,
  p_rbi        int,
  p_bb         int,
  p_so         int,
  p_era_runs   int,
  p_era_outs   int,
  -- New pitching params
  p_p_ip       real DEFAULT 0,
  p_p_h        int  DEFAULT 0,
  p_p_r        int  DEFAULT 0,
  p_p_er       int  DEFAULT 0,
  p_p_bb       int  DEFAULT 0,
  p_p_so       int  DEFAULT 0,
  p_p_hr       int  DEFAULT 0
)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.standings
    (league_id, team_id, season_no, w, l, ab, r, h, b2, b3, hr, rbi, bb, so, era_runs, era_outs,
     p_ip, p_h, p_r, p_er, p_bb, p_so, p_hr)
  VALUES
    (p_league_id, p_team_id, p_season_no, p_w, p_l, p_ab, p_r, p_h, p_b2, p_b3, p_hr, p_rbi, p_bb, p_so, p_era_runs, p_era_outs,
     p_p_ip, p_p_h, p_p_r, p_p_er, p_p_bb, p_p_so, p_p_hr)
  ON CONFLICT (league_id, team_id, season_no)
  DO UPDATE SET
    w         = standings.w         + excluded.w,
    l         = standings.l         + excluded.l,
    ab        = standings.ab        + excluded.ab,
    r         = standings.r         + excluded.r,
    h         = standings.h         + excluded.h,
    b2        = standings.b2        + excluded.b2,
    b3        = standings.b3        + excluded.b3,
    hr        = standings.hr        + excluded.hr,
    rbi       = standings.rbi       + excluded.rbi,
    bb        = standings.bb        + excluded.bb,
    so        = standings.so        + excluded.so,
    era_runs  = standings.era_runs  + excluded.era_runs,
    era_outs  = standings.era_outs  + excluded.era_outs,
    p_ip      = public.add_ip(standings.p_ip, excluded.p_ip),
    p_h       = standings.p_h       + excluded.p_h,
    p_r       = standings.p_r       + excluded.p_r,
    p_er      = standings.p_er      + excluded.p_er,
    p_bb      = standings.p_bb      + excluded.p_bb,
    p_so      = standings.p_so      + excluded.p_so,
    p_hr      = standings.p_hr      + excluded.p_hr;
END;
$$;
