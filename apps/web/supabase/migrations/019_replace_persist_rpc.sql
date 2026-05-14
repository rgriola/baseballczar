-- Migration 019: Replace persist_sim_game_transaction for renamed tables + new columns

DROP FUNCTION IF EXISTS public.persist_sim_game_transaction(bigint,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,jsonb,bigint,bigint);

CREATE OR REPLACE FUNCTION public.persist_sim_game_transaction(
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
RETURNS bigint
LANGUAGE plpgsql
AS $$
DECLARE
  v_schedule_played boolean;
  v_schedule_home_team_id bigint;
  v_schedule_visitor_team_id bigint;
  v_home_team_id bigint;
  v_visitor_team_id bigint;
  v_game_id bigint;
BEGIN
  SELECT played, home_team_id, visitor_team_id
    INTO v_schedule_played, v_schedule_home_team_id, v_schedule_visitor_team_id
    FROM public.schedules
   WHERE id = p_schedule_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Schedule % not found', p_schedule_id;
  END IF;

  IF v_schedule_played THEN
    RAISE EXCEPTION 'Schedule % already played', p_schedule_id;
  END IF;

  v_home_team_id := (p_game_row->>'home_team_id')::bigint;
  v_visitor_team_id := (p_game_row->>'visitor_team_id')::bigint;

  IF v_home_team_id IS NULL OR v_visitor_team_id IS NULL THEN
    RAISE EXCEPTION 'Game payload is missing team ids';
  END IF;

  IF v_home_team_id <> v_schedule_home_team_id OR v_visitor_team_id <> v_schedule_visitor_team_id THEN
    RAISE EXCEPTION 'Game payload teams %/% do not match schedule teams %/%',
      v_home_team_id, v_visitor_team_id, v_schedule_home_team_id, v_schedule_visitor_team_id;
  END IF;

  -- Insert game header
  INSERT INTO public.games (
    schedule_id, league_id, home_team_id, visitor_team_id,
    home_runs, visitor_runs, home_hits, visitor_hits,
    home_errors, visitor_errors, innings,
    winning_team_id, losing_team_id,
    home_linescore, visitor_linescore,
    sim_seed, sim_version, sim_config_version
  )
  VALUES (
    p_schedule_id,
    (p_game_row->>'league_id')::bigint,
    v_home_team_id, v_visitor_team_id,
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
    nullif(p_game_row->>'sim_config_version', '')
  )
  RETURNING id INTO v_game_id;

  -- Insert game events
  IF jsonb_typeof(coalesce(p_event_rows, '[]'::jsonb)) = 'array'
     AND jsonb_array_length(coalesce(p_event_rows, '[]'::jsonb)) > 0 THEN
    INSERT INTO public.game_events (
      game_id, seq, inning, half, outs,
      batter_name, pitcher_name, outcome, description,
      visitor_runs, home_runs, visitor_hits, home_hits,
      runners_scored, hit_zone,
      spray_angle_deg, launch_angle_deg, exit_velo_mph,
      ball_path_waypoints, base_occupancy_before, base_occupancy_after
    )
    SELECT
      v_game_id,
      (e->>'seq')::int, (e->>'inning')::int, (e->>'half')::text, (e->>'outs')::int,
      (e->>'batter_name')::text, (e->>'pitcher_name')::text,
      (e->>'outcome')::int, e->>'description',
      (e->>'visitor_runs')::int, (e->>'home_runs')::int,
      (e->>'visitor_hits')::int, (e->>'home_hits')::int,
      CASE WHEN jsonb_typeof(e->'runners_scored') = 'array'
        THEN array(SELECT jsonb_array_elements_text(e->'runners_scored'))
        ELSE NULL END,
      nullif(e->>'hit_zone', ''),
      (e->>'spray_angle_deg')::real, (e->>'launch_angle_deg')::real,
      (e->>'exit_velo_mph')::real,
      e->'ball_path_waypoints', e->'base_occupancy_before', e->'base_occupancy_after'
    FROM jsonb_array_elements(coalesce(p_event_rows, '[]'::jsonb)) AS e;
  END IF;

  -- Insert hitter game stats (renamed table + new columns)
  IF jsonb_typeof(coalesce(p_game_hitting_rows, '[]'::jsonb)) = 'array'
     AND jsonb_array_length(coalesce(p_game_hitting_rows, '[]'::jsonb)) > 0 THEN
    INSERT INTO public.hitter_game_stats (
      game_id, player_id, team_id, opp_team_id,
      bat_order, position, game_type,
      g, pa, ab, r, h, b2, b3, hr, rbi, bb, so, sb, cs, sf, sac,
      putouts, assists, errors,
      batted_balls, total_ev, total_la, total_spray, total_bat_speed
    )
    SELECT
      v_game_id,
      (s->>'player_id')::bigint, (s->>'team_id')::bigint,
      (s->>'opp_team_id')::bigint, (s->>'bat_order')::real,
      nullif(s->>'position', ''), (s->>'game_type')::text,
      coalesce((s->>'g')::int, 1),
      coalesce((s->>'pa')::int, 0),
      (s->>'ab')::int, (s->>'r')::int, (s->>'h')::int,
      (s->>'b2')::int, (s->>'b3')::int, (s->>'hr')::int,
      (s->>'rbi')::int, (s->>'bb')::int, (s->>'so')::int,
      coalesce((s->>'sb')::int, 0), coalesce((s->>'cs')::int, 0),
      coalesce((s->>'sf')::int, 0), coalesce((s->>'sac')::int, 0),
      coalesce((s->>'putouts')::int, 0),
      coalesce((s->>'assists')::int, 0),
      coalesce((s->>'errors')::int, 0),
      coalesce((s->>'batted_balls')::int, 0),
      coalesce((s->>'total_ev')::real, 0),
      coalesce((s->>'total_la')::real, 0),
      coalesce((s->>'total_spray')::real, 0),
      coalesce((s->>'total_bat_speed')::real, 0)
    FROM jsonb_array_elements(coalesce(p_game_hitting_rows, '[]'::jsonb)) AS s;
  END IF;

  -- Insert pitcher game stats (renamed table + new columns)
  IF jsonb_typeof(coalesce(p_game_pitching_rows, '[]'::jsonb)) = 'array'
     AND jsonb_array_length(coalesce(p_game_pitching_rows, '[]'::jsonb)) > 0 THEN
    INSERT INTO public.pitcher_game_stats (
      game_id, player_id, team_id, opp_team_id,
      pitch_app, game_type,
      w, l, g, gs, cg, sho, sv, ip, ab, r, er, h, b2, b3, hr, rbi, bb, so,
      pitches, total_mph, putouts, assists, errors
    )
    SELECT
      v_game_id,
      (s->>'player_id')::bigint, (s->>'team_id')::bigint,
      (s->>'opp_team_id')::bigint, (s->>'pitch_app')::real,
      (s->>'game_type')::text,
      (s->>'w')::int, (s->>'l')::int, (s->>'g')::int,
      (s->>'gs')::int, (s->>'cg')::int, (s->>'sho')::int, (s->>'sv')::int,
      (s->>'ip')::real, (s->>'ab')::int, (s->>'r')::int, (s->>'er')::int,
      (s->>'h')::int, coalesce((s->>'b2')::int, 0), coalesce((s->>'b3')::int, 0),
      (s->>'hr')::int, coalesce((s->>'rbi')::int, 0),
      (s->>'bb')::int, (s->>'so')::int,
      coalesce((s->>'pitches')::int, 0),
      coalesce((s->>'total_mph')::real, 0),
      coalesce((s->>'putouts')::int, 0),
      coalesce((s->>'assists')::int, 0),
      coalesce((s->>'errors')::int, 0)
    FROM jsonb_array_elements(coalesce(p_game_pitching_rows, '[]'::jsonb)) AS s;
  END IF;

  -- Season stats upserts
  IF jsonb_typeof(coalesce(p_season_hitting_rows, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'p_season_hitting_rows must be a JSON array';
  END IF;
  IF jsonb_typeof(coalesce(p_season_pitching_rows, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'p_season_pitching_rows must be a JSON array';
  END IF;

  PERFORM public.batch_upsert_season_hitting(coalesce(p_season_hitting_rows, '[]'::jsonb));
  PERFORM public.batch_upsert_season_pitching(coalesce(p_season_pitching_rows, '[]'::jsonb));

  -- Standings
  PERFORM public.upsert_standing(
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
    (p_home_standing_delta->>'era_outs')::int,
    coalesce((p_home_standing_delta->>'p_ip')::real, 0),
    coalesce((p_home_standing_delta->>'p_h')::int, 0),
    coalesce((p_home_standing_delta->>'p_r')::int, 0),
    coalesce((p_home_standing_delta->>'p_er')::int, 0),
    coalesce((p_home_standing_delta->>'p_bb')::int, 0),
    coalesce((p_home_standing_delta->>'p_so')::int, 0),
    coalesce((p_home_standing_delta->>'p_hr')::int, 0)
  );

  PERFORM public.upsert_standing(
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
    (p_visitor_standing_delta->>'era_outs')::int,
    coalesce((p_visitor_standing_delta->>'p_ip')::real, 0),
    coalesce((p_visitor_standing_delta->>'p_h')::int, 0),
    coalesce((p_visitor_standing_delta->>'p_r')::int, 0),
    coalesce((p_visitor_standing_delta->>'p_er')::int, 0),
    coalesce((p_visitor_standing_delta->>'p_bb')::int, 0),
    coalesce((p_visitor_standing_delta->>'p_so')::int, 0),
    coalesce((p_visitor_standing_delta->>'p_hr')::int, 0)
  );

  -- Financial transactions
  IF jsonb_typeof(coalesce(p_financial_rows, '[]'::jsonb)) = 'array'
     AND jsonb_array_length(coalesce(p_financial_rows, '[]'::jsonb)) > 0 THEN
    INSERT INTO public.financial_transactions (team_id, type, amount, description, reference_id)
    SELECT
      (f->>'team_id')::bigint, (f->>'type')::text, (f->>'amount')::bigint,
      nullif(f->>'description', ''), v_game_id
    FROM jsonb_array_elements(coalesce(p_financial_rows, '[]'::jsonb)) AS f;
  END IF;

  PERFORM public.safe_credit(v_home_team_id, p_home_credit_amount, 'LGR_home',
    format('Game %s home revenue', v_game_id), v_game_id);
  PERFORM public.safe_credit(v_visitor_team_id, p_visitor_credit_amount, 'LGR_visitor',
    format('Game %s visitor revenue', v_game_id), v_game_id);

  UPDATE public.schedules SET played = true WHERE id = p_schedule_id AND played = false;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Schedule % became played during transaction', p_schedule_id;
  END IF;

  RETURN v_game_id;
END;
$$;

COMMENT ON FUNCTION public.persist_sim_game_transaction(
  bigint, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, jsonb, bigint, bigint
) IS 'Atomic persistence for sim game results — uses renamed tables with analytics columns';
