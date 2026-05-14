-- ═══════════════════════════════════════════════════════════════════════
-- Migration 016: Update batch_upsert_season_hitting to accumulate sb/cs
-- ═══════════════════════════════════════════════════════════════════════
-- The player_stats_hitting table already has sb and cs columns (migration 001).
-- This migration updates the RPC to include them in the INSERT and ON CONFLICT
-- accumulation so they are tracked across season games.

create or replace function public.batch_upsert_season_hitting(p_stats jsonb)
returns void
language plpgsql
as $$
begin
  insert into public.player_stats_hitting
    (player_id, team_id, season_no, g, ab, r, h, b2, b3, hr, rbi, bb, so, sb, cs)
  select
    (s->>'player_id')::bigint,
    (s->>'team_id')::bigint,
    (s->>'season_no')::int,
    (s->>'g')::int,
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
    coalesce((s->>'cs')::int, 0)
  from jsonb_array_elements(p_stats) as s
  on conflict (player_id, team_id, season_no)
  do update set
    g   = player_stats_hitting.g   + excluded.g,
    ab  = player_stats_hitting.ab  + excluded.ab,
    r   = player_stats_hitting.r   + excluded.r,
    h   = player_stats_hitting.h   + excluded.h,
    b2  = player_stats_hitting.b2  + excluded.b2,
    b3  = player_stats_hitting.b3  + excluded.b3,
    hr  = player_stats_hitting.hr  + excluded.hr,
    rbi = player_stats_hitting.rbi + excluded.rbi,
    bb  = player_stats_hitting.bb  + excluded.bb,
    so  = player_stats_hitting.so  + excluded.so,
    sb  = player_stats_hitting.sb  + excluded.sb,
    cs  = player_stats_hitting.cs  + excluded.cs;
end;
$$;
