-- ═══════════════════════════════════════════════════════════════════════
-- Migration 004: Safe budget RPCs, DB constraints, batch upsert RPCs
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. Safe debit: atomic check-and-debit with row locking ──────────

create or replace function public.safe_debit(
  p_team_id   bigint,
  p_amount    bigint,
  p_type      text,
  p_desc      text,
  p_ref_id    bigint default null
)
returns bigint
language plpgsql
as $$
declare
  v_balance bigint;
  v_new     bigint;
begin
  -- Lock the budget row for this team
  select balance into v_balance
    from public.team_budgets
   where team_id = p_team_id
   for update;

  if not found then
    raise exception 'No budget row for team %', p_team_id;
  end if;

  if v_balance < p_amount then
    return -1; -- insufficient funds sentinel
  end if;

  v_new := v_balance - p_amount;

  update public.team_budgets
     set balance = v_new, updated_at = now()
   where team_id = p_team_id;

  insert into public.financial_transactions
    (team_id, type, amount, description, reference_id)
  values
    (p_team_id, p_type, -p_amount, p_desc, p_ref_id);

  return v_new;
end;
$$;

-- ─── 2. Safe credit: atomic credit with row locking ──────────────────

create or replace function public.safe_credit(
  p_team_id   bigint,
  p_amount    bigint,
  p_type      text,
  p_desc      text,
  p_ref_id    bigint default null
)
returns bigint
language plpgsql
as $$
declare
  v_balance bigint;
  v_new     bigint;
begin
  select balance into v_balance
    from public.team_budgets
   where team_id = p_team_id
   for update;

  if not found then
    raise exception 'No budget row for team %', p_team_id;
  end if;

  v_new := v_balance + p_amount;

  update public.team_budgets
     set balance = v_new, updated_at = now()
   where team_id = p_team_id;

  insert into public.financial_transactions
    (team_id, type, amount, description, reference_id)
  values
    (p_team_id, p_type, p_amount, p_desc, p_ref_id);

  return v_new;
end;
$$;

-- ─── 3. Database constraints ─────────────────────────────────────────

-- Prevent negative budgets
alter table public.team_budgets
  add constraint budget_non_negative check (balance >= 0);

-- Player skill ranges (0-100 real scale)
alter table public.players
  add constraint chk_speed    check (speed    between 0 and 100),
  add constraint chk_stamina  check (stamina  between 0 and 100),
  add constraint chk_ag       check (ag       between 0 and 100),
  add constraint chk_eye      check (eye      between 0 and 100),
  add constraint chk_avg      check (avg      between 0 and 100),
  add constraint chk_strength check (strength between 0 and 100),
  add constraint chk_dhr      check (dhr      between 0 and 100),
  add constraint chk_pi       check (play_intel between 0 and 100),
  add constraint chk_bunting  check (bunting  between 0 and 100),
  add constraint chk_fielding check (fielding between 0 and 100),
  add constraint chk_throw    check (throw    between 0 and 100),
  add constraint chk_karma    check (karma    between 0 and 100);

-- Non-negative season batting stats
alter table public.player_stats_hitting
  add constraint psh_g_nn   check (g  >= 0),
  add constraint psh_ab_nn  check (ab >= 0),
  add constraint psh_r_nn   check (r  >= 0),
  add constraint psh_h_nn   check (h  >= 0),
  add constraint psh_hr_nn  check (hr >= 0),
  add constraint psh_bb_nn  check (bb >= 0),
  add constraint psh_so_nn  check (so >= 0);

-- Non-negative season pitching stats
alter table public.player_stats_pitching
  add constraint psp_w_nn  check (w  >= 0),
  add constraint psp_l_nn  check (l  >= 0),
  add constraint psp_g_nn  check (g  >= 0),
  add constraint psp_ip_nn check (ip >= 0),
  add constraint psp_er_nn check (er >= 0),
  add constraint psp_bb_nn check (bb >= 0),
  add constraint psp_so_nn check (so >= 0);

-- Non-negative standings
alter table public.standings
  add constraint std_w_nn check (w >= 0),
  add constraint std_l_nn check (l >= 0);

-- ─── 4. Batch upsert: season hitting stats ───────────────────────────

create or replace function public.batch_upsert_season_hitting(p_stats jsonb)
returns void
language plpgsql
as $$
begin
  insert into public.player_stats_hitting
    (player_id, team_id, season_no, g, ab, r, h, b2, b3, hr, rbi, bb, so)
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
    (s->>'so')::int
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
    so  = player_stats_hitting.so  + excluded.so;
end;
$$;

-- ─── 5. Batch upsert: season pitching stats ─────────────────────────

create or replace function public.batch_upsert_season_pitching(p_stats jsonb)
returns void
language plpgsql
as $$
begin
  insert into public.player_stats_pitching
    (player_id, team_id, season_no, w, l, g, gs, cg, sv, sho, ip, bf, h, r, er, bb, so, hr)
  select
    (s->>'player_id')::bigint,
    (s->>'team_id')::bigint,
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
    (s->>'hr')::int
  from jsonb_array_elements(p_stats) as s
  on conflict (player_id, team_id, season_no)
  do update set
    w   = player_stats_pitching.w   + excluded.w,
    l   = player_stats_pitching.l   + excluded.l,
    g   = player_stats_pitching.g   + excluded.g,
    gs  = player_stats_pitching.gs  + excluded.gs,
    cg  = player_stats_pitching.cg  + excluded.cg,
    sv  = player_stats_pitching.sv  + excluded.sv,
    sho = player_stats_pitching.sho + excluded.sho,
    ip  = public.add_ip(player_stats_pitching.ip, excluded.ip),
    bf  = player_stats_pitching.bf  + excluded.bf,
    h   = player_stats_pitching.h   + excluded.h,
    r   = player_stats_pitching.r   + excluded.r,
    er  = player_stats_pitching.er  + excluded.er,
    bb  = player_stats_pitching.bb  + excluded.bb,
    so  = player_stats_pitching.so  + excluded.so,
    hr  = player_stats_pitching.hr  + excluded.hr;
end;
$$;

-- ─── 6. Helper: add baseball IP notation (6.2 + 3.1 = 10.0, not 9.3) ─

create or replace function public.add_ip(a real, b real)
returns real
language plpgsql immutable
as $$
declare
  a_outs int;
  b_outs int;
  total  int;
begin
  a_outs := (floor(a)::int * 3) + round((a - floor(a)) * 10)::int;
  b_outs := (floor(b)::int * 3) + round((b - floor(b)) * 10)::int;
  total  := a_outs + b_outs;
  return (total / 3) + (total % 3) * 0.1;
end;
$$;

-- ─── 7. Batch standings upsert ───────────────────────────────────────

create or replace function public.upsert_standing(
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
  p_era_outs   int
)
returns void
language plpgsql
as $$
begin
  insert into public.standings
    (league_id, team_id, season_no, w, l, ab, r, h, b2, b3, hr, rbi, bb, so, era_runs, era_outs)
  values
    (p_league_id, p_team_id, p_season_no, p_w, p_l, p_ab, p_r, p_h, p_b2, p_b3, p_hr, p_rbi, p_bb, p_so, p_era_runs, p_era_outs)
  on conflict (league_id, team_id, season_no)
  do update set
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
    era_outs  = standings.era_outs  + excluded.era_outs;
end;
$$;
