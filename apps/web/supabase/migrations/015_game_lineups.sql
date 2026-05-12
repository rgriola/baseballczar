-- ═══════════════════════════════════════════════════════════════════════
-- Per-Game Lineups & Rotation
-- Moves batt_order/position/rotation_slot from players (team-wide default)
-- into per-schedule-entry tables so each game can have its own lineup.
-- ═══════════════════════════════════════════════════════════════════════

-- 1. GAME LINEUPS — per-game batting order + defensive position
create table public.game_lineups (
  id              bigint generated always as identity primary key,
  schedule_id     bigint not null references public.schedules(id) on delete cascade,
  team_id         bigint not null references public.teams(id) on delete cascade,
  player_id       bigint not null references public.players(id) on delete cascade,
  batt_order      int not null default 0,        -- 1-9 lineup, 0 = bench
  position        text not null default 'UTIL',  -- C/1B/2B/3B/SS/LF/CF/RF/DH or Bx for bench

  unique(schedule_id, team_id, player_id)
);

create index idx_gl_schedule on public.game_lineups(schedule_id, team_id);
create index idx_gl_player on public.game_lineups(player_id);

-- 2. GAME ROTATION — per-game pitching staff assignments
create table public.game_rotation (
  id              bigint generated always as identity primary key,
  schedule_id     bigint not null references public.schedules(id) on delete cascade,
  team_id         bigint not null references public.teams(id) on delete cascade,
  player_id       bigint not null references public.players(id) on delete cascade,
  rotation_slot   int not null default 0,        -- 1-5 SP, 6-9 RP, 10 CL, 11-12 extra RP

  unique(schedule_id, team_id, player_id)
);

create index idx_gr_schedule on public.game_rotation(schedule_id, team_id);
create index idx_gr_player on public.game_rotation(player_id);

-- 3. RLS policies
alter table public.game_lineups enable row level security;
alter table public.game_rotation enable row level security;

-- Public read
create policy "game_lineups_read" on public.game_lineups for select using (true);
create policy "game_rotation_read" on public.game_rotation for select using (true);

-- Owner write (lineup)
create policy "game_lineups_owner_insert" on public.game_lineups for insert
  with check (team_id in (select id from public.teams where owner_id = auth.uid()));
create policy "game_lineups_owner_update" on public.game_lineups for update
  using (team_id in (select id from public.teams where owner_id = auth.uid()));
create policy "game_lineups_owner_delete" on public.game_lineups for delete
  using (team_id in (select id from public.teams where owner_id = auth.uid()));

-- Owner write (rotation)
create policy "game_rotation_owner_insert" on public.game_rotation for insert
  with check (team_id in (select id from public.teams where owner_id = auth.uid()));
create policy "game_rotation_owner_update" on public.game_rotation for update
  using (team_id in (select id from public.teams where owner_id = auth.uid()));
create policy "game_rotation_owner_delete" on public.game_rotation for delete
  using (team_id in (select id from public.teams where owner_id = auth.uid()));

-- 4. Backfill: copy current players lineup/rotation into game_lineups/game_rotation
--    for all unplayed schedule entries.
insert into public.game_lineups (schedule_id, team_id, player_id, batt_order, position)
select s.id, p.team_id, p.id, p.batt_order, p.position
from public.schedules s
join public.players p
  on p.team_id in (s.home_team_id, s.visitor_team_id)
  and p.fielder = true
  and p.roster_status = 'active'
  and p.batt_order >= 0
where s.played = false
on conflict (schedule_id, team_id, player_id) do nothing;

insert into public.game_rotation (schedule_id, team_id, player_id, rotation_slot)
select s.id, p.team_id, p.id, p.rotation_slot
from public.schedules s
join public.players p
  on p.team_id in (s.home_team_id, s.visitor_team_id)
  and p.fielder = false
  and p.roster_status = 'active'
  and p.rotation_slot > 0
where s.played = false
on conflict (schedule_id, team_id, player_id) do nothing;
