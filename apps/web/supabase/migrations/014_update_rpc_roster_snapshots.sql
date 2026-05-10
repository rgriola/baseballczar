-- Migration 014: Update persist_sim_game_transaction to include roster snapshot columns.
-- The RPC function extracts JSONB fields from p_game_row by name. Migration 013
-- added the columns but the RPC INSERT didn't reference them. This replaces the
-- function to include home_roster_snapshot and visitor_roster_snapshot.

create or replace function public.persist_sim_game_transaction(
  p_schedule_id bigint,
  p_game_row jsonb,
  p_event_rows jsonb,
  p_game_hitting_rows jsonb,
  p_game_pitching_rows jsonb,
  p_season_hitting_rows jsonb,
  p_season_pitching_rows jsonb,
  p_home_standing_delta jsonb,
  p_visitor_standing_delta jsonb,
  p_financial_rows jsonb,
  p_home_credit_amount bigint,
  p_visitor_credit_amount bigint
)
returns bigint
language plpgsql
as $$
declare
  v_schedule_played boolean;
  v_schedule_home_team_id bigint;
  v_schedule_visitor_team_id bigint;
  v_home_team_id bigint;
  v_visitor_team_id bigint;
  v_game_id bigint;
begin
  select played, home_team_id, visitor_team_id
    into v_schedule_played, v_schedule_home_team_id, v_schedule_visitor_team_id
    from public.schedules
   where id = p_schedule_id
   for update;

  if not found then
    raise exception 'Schedule % not found', p_schedule_id;
  end if;

  if v_schedule_played then
    raise exception 'Schedule % already played', p_schedule_id;
  end if;

  v_home_team_id := (p_game_row->>'home_team_id')::bigint;
  v_visitor_team_id := (p_game_row->>'visitor_team_id')::bigint;

  if v_home_team_id is null or v_visitor_team_id is null then
    raise exception 'Game payload is missing team ids';
  end if;

  if v_home_team_id <> v_schedule_home_team_id or v_visitor_team_id <> v_schedule_visitor_team_id then
    raise exception 'Game payload teams %/% do not match schedule teams %/%',
      v_home_team_id, v_visitor_team_id, v_schedule_home_team_id, v_schedule_visitor_team_id;
  end if;

  insert into public.games (
    schedule_id,
    league_id,
    home_team_id,
    visitor_team_id,
    home_runs,
    visitor_runs,
    home_hits,
    visitor_hits,
    home_errors,
    visitor_errors,
    innings,
    winning_team_id,
    losing_team_id,
    home_linescore,
    visitor_linescore,
    sim_seed,
    sim_version,
    sim_config_version,
    home_roster_snapshot,
    visitor_roster_snapshot
  )
  values (
    p_schedule_id,
    (p_game_row->>'league_id')::bigint,
    v_home_team_id,
    v_visitor_team_id,
    (p_game_row->>'home_runs')::int,
    (p_game_row->>'visitor_runs')::int,
    (p_game_row->>'home_hits')::int,
    (p_game_row->>'visitor_hits')::int,
    coalesce((p_game_row->>'home_errors')::int, 0),
    coalesce((p_game_row->>'visitor_errors')::int, 0),
    (p_game_row->>'innings')::int,
    (p_game_row->>'winning_team_id')::bigint,
    (p_game_row->>'losing_team_id')::bigint,
    p_game_row->'home_linescore',
    p_game_row->'visitor_linescore',
    (p_game_row->>'sim_seed')::int,
    nullif(p_game_row->>'sim_version', ''),
    nullif(p_game_row->>'sim_config_version', ''),
    p_game_row->'home_roster_snapshot',
    p_game_row->'visitor_roster_snapshot'
  )
  returning id into v_game_id;

  if jsonb_typeof(coalesce(p_event_rows, '[]'::jsonb)) = 'array'
     and jsonb_array_length(coalesce(p_event_rows, '[]'::jsonb)) > 0 then
    insert into public.game_events (
      game_id,
      seq,
      inning,
      half,
      outs,
      batter_name,
      pitcher_name,
      outcome,
      description,
      visitor_runs,
      home_runs,
      visitor_hits,
      home_hits,
      runners_scored,
      hit_zone,
      spray_angle_deg,
      launch_angle_deg,
      exit_velo_mph,
      ball_path_waypoints,
      base_occupancy_before,
      base_occupancy_after
    )
    select
      v_game_id,
      (e->>'seq')::int,
      (e->>'inning')::int,
      (e->>'half')::text,
      (e->>'outs')::int,
      (e->>'batter_name')::text,
      (e->>'pitcher_name')::text,
      (e->>'outcome')::int,
      e->>'description',
      (e->>'visitor_runs')::int,
      (e->>'home_runs')::int,
      (e->>'visitor_hits')::int,
      (e->>'home_hits')::int,
      case
        when jsonb_typeof(e->'runners_scored') = 'array' then
          array(select jsonb_array_elements_text(e->'runners_scored'))
        else null
      end,
      nullif(e->>'hit_zone', ''),
      (e->>'spray_angle_deg')::real,
      (e->>'launch_angle_deg')::real,
      (e->>'exit_velo_mph')::real,
      e->'ball_path_waypoints',
      e->'base_occupancy_before',
      e->'base_occupancy_after'
    from jsonb_array_elements(coalesce(p_event_rows, '[]'::jsonb)) as e;
  end if;

  if jsonb_typeof(coalesce(p_game_hitting_rows, '[]'::jsonb)) = 'array'
     and jsonb_array_length(coalesce(p_game_hitting_rows, '[]'::jsonb)) > 0 then
    insert into public.game_stats_hitting (
      game_id,
      player_id,
      team_id,
      opp_team_id,
      bat_order,
      position,
      game_type,
      g,
      ab,
      r,
      h,
      b2,
      b3,
      hr,
      rbi,
      bb,
      so,
      sb,
      cs,
      sf,
      sac
    )
    select
      v_game_id,
      (s->>'player_id')::bigint,
      (s->>'team_id')::bigint,
      (s->>'opp_team_id')::bigint,
      (s->>'bat_order')::real,
      nullif(s->>'position', ''),
      (s->>'game_type')::text,
      coalesce((s->>'g')::int, 1),
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
      coalesce((s->>'sf')::int, 0),
      coalesce((s->>'sac')::int, 0)
    from jsonb_array_elements(coalesce(p_game_hitting_rows, '[]'::jsonb)) as s;
  end if;

  if jsonb_typeof(coalesce(p_game_pitching_rows, '[]'::jsonb)) = 'array'
     and jsonb_array_length(coalesce(p_game_pitching_rows, '[]'::jsonb)) > 0 then
    insert into public.game_stats_pitching (
      game_id,
      player_id,
      team_id,
      opp_team_id,
      pitch_app,
      game_type,
      w,
      l,
      g,
      gs,
      cg,
      sho,
      sv,
      ip,
      ab,
      r,
      er,
      h,
      b2,
      b3,
      hr,
      rbi,
      bb,
      so
    )
    select
      v_game_id,
      (s->>'player_id')::bigint,
      (s->>'team_id')::bigint,
      (s->>'opp_team_id')::bigint,
      (s->>'pitch_app')::real,
      (s->>'game_type')::text,
      (s->>'w')::int,
      (s->>'l')::int,
      (s->>'g')::int,
      (s->>'gs')::int,
      (s->>'cg')::int,
      (s->>'sho')::int,
      (s->>'sv')::int,
      (s->>'ip')::real,
      (s->>'ab')::int,
      (s->>'r')::int,
      (s->>'er')::int,
      (s->>'h')::int,
      coalesce((s->>'b2')::int, 0),
      coalesce((s->>'b3')::int, 0),
      (s->>'hr')::int,
      coalesce((s->>'rbi')::int, 0),
      (s->>'bb')::int,
      (s->>'so')::int
    from jsonb_array_elements(coalesce(p_game_pitching_rows, '[]'::jsonb)) as s;
  end if;

  if jsonb_typeof(coalesce(p_season_hitting_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'p_season_hitting_rows must be a JSON array';
  end if;

  if jsonb_typeof(coalesce(p_season_pitching_rows, '[]'::jsonb)) <> 'array' then
    raise exception 'p_season_pitching_rows must be a JSON array';
  end if;

  perform public.batch_upsert_season_hitting(coalesce(p_season_hitting_rows, '[]'::jsonb));
  perform public.batch_upsert_season_pitching(coalesce(p_season_pitching_rows, '[]'::jsonb));

  perform public.upsert_standing(
    (p_home_standing_delta->>'league_id')::bigint,
    (p_home_standing_delta->>'team_id')::bigint,
    (p_home_standing_delta->>'season_no')::int,
    (p_home_standing_delta->>'w')::int,
    (p_home_standing_delta->>'l')::int,
    (p_home_standing_delta->>'ab')::int,
    (p_home_standing_delta->>'r')::int,
    (p_home_standing_delta->>'h')::int,
    (p_home_standing_delta->>'b2')::int,
    (p_home_standing_delta->>'b3')::int,
    (p_home_standing_delta->>'hr')::int,
    (p_home_standing_delta->>'rbi')::int,
    (p_home_standing_delta->>'bb')::int,
    (p_home_standing_delta->>'so')::int,
    (p_home_standing_delta->>'era_runs')::int,
    (p_home_standing_delta->>'era_outs')::int
  );

  perform public.upsert_standing(
    (p_visitor_standing_delta->>'league_id')::bigint,
    (p_visitor_standing_delta->>'team_id')::bigint,
    (p_visitor_standing_delta->>'season_no')::int,
    (p_visitor_standing_delta->>'w')::int,
    (p_visitor_standing_delta->>'l')::int,
    (p_visitor_standing_delta->>'ab')::int,
    (p_visitor_standing_delta->>'r')::int,
    (p_visitor_standing_delta->>'h')::int,
    (p_visitor_standing_delta->>'b2')::int,
    (p_visitor_standing_delta->>'b3')::int,
    (p_visitor_standing_delta->>'hr')::int,
    (p_visitor_standing_delta->>'rbi')::int,
    (p_visitor_standing_delta->>'bb')::int,
    (p_visitor_standing_delta->>'so')::int,
    (p_visitor_standing_delta->>'era_runs')::int,
    (p_visitor_standing_delta->>'era_outs')::int
  );

  if jsonb_typeof(coalesce(p_financial_rows, '[]'::jsonb)) = 'array'
     and jsonb_array_length(coalesce(p_financial_rows, '[]'::jsonb)) > 0 then
    insert into public.financial_transactions (
      team_id,
      type,
      amount,
      description,
      reference_id
    )
    select
      (f->>'team_id')::bigint,
      (f->>'type')::text,
      (f->>'amount')::bigint,
      nullif(f->>'description', ''),
      v_game_id
    from jsonb_array_elements(coalesce(p_financial_rows, '[]'::jsonb)) as f;
  end if;

  perform public.safe_credit(
    v_home_team_id,
    p_home_credit_amount,
    'LGR_home',
    format('Game %s home revenue', v_game_id),
    v_game_id
  );

  perform public.safe_credit(
    v_visitor_team_id,
    p_visitor_credit_amount,
    'LGR_visitor',
    format('Game %s visitor revenue', v_game_id),
    v_game_id
  );

  update public.schedules
     set played = true
   where id = p_schedule_id
     and played = false;

  if not found then
    raise exception 'Schedule % became played during transaction', p_schedule_id;
  end if;

  return v_game_id;
end;
$$;

comment on function public.persist_sim_game_transaction(
  bigint,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  jsonb,
  bigint,
  bigint
) is 'Atomic persistence boundary for scheduled simulation game results';
