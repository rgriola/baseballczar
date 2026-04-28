-- Baseball Czar Reboot — Phase 2 Supabase Schema Migration
-- Translated from original MySQL schema (BBCzar_Master) to PostgreSQL
-- Tables: leagues, teams, players, schedules, standings, game results, stats, finance, market, challenges, notifications, names

-- ═══════════════════════════════════════════════════════════════════════
-- 1. LEAGUES
-- ═══════════════════════════════════════════════════════════════════════
create table public.leagues (
  id            bigint generated always as identity primary key,
  league_name   text not null,
  division      text not null default 'Premiere',
  sub           text,
  season_no     int not null default 1,
  max_teams     int not null default 6,
  status        text not null default 'open' check (status in ('open','full','archived')),
  created_at    timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════════════
-- 2. TEAMS  (maps to original Team_List + owner profile)
-- ═══════════════════════════════════════════════════════════════════════
create table public.teams (
  id            bigint generated always as identity primary key,
  owner_id      uuid references auth.users(id) on delete set null,
  league_id     bigint references public.leagues(id) on delete set null,
  team_name     text not null,
  country_id    int not null default 1,

  -- Owner profile fields (from Team_List / profile.php)
  first_name    text,
  last_name     text,
  email         text,
  street        text,
  street_2      text,
  city          text,
  zipcode       text,

  created_at    timestamptz not null default now()
);

create index idx_teams_league on public.teams(league_id);
create index idx_teams_owner on public.teams(owner_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 3. PLAYERS  (maps to original per-team tables with 37 attributes)
-- ═══════════════════════════════════════════════════════════════════════
create table public.players (
  id              bigint generated always as identity primary key,
  team_id         bigint references public.teams(id) on delete set null,
  first_name      text not null,
  last_name       text not null,
  jersey_no       int not null default 0,
  position        text not null default 'UTIL',

  -- Roster status
  roster_status   text not null default 'active' check (roster_status in ('active','reserve','free_agent')),
  fielder         boolean not null default true,   -- true = position player, false = pitcher
  batt_order      int default 0,                   -- 1-9 lineup slot, 0 = not in lineup
  rotation_slot   int default 0,                   -- 1-5 for starting rotation, 0 = bullpen/not pitcher

  -- Demographics
  age             int not null default 20,
  salary          int not null default 50000,
  contract        int not null default 4,          -- years remaining
  height          int default 72,                  -- inches
  weight          int default 185,                 -- lbs
  hand_throw      int default 1,                   -- 1=R, 2=L
  hand_batting    int default 1,                   -- 1=R, 2=L, 3=S

  -- Core skills (1-10 scale, matching original Java engine)
  speed           real not null default 5,
  stamina         real not null default 5,         -- ST: pitcher fatigue rate
  ag              real not null default 5,          -- Discipline
  eye             real not null default 5,          -- Plate vision
  avg             real not null default 5,          -- Consistency
  strength        real not null default 5,         -- POWER / STRENGTH
  dhr             real not null default 5,          -- Doubles/HR distribution
  play_intel      real not null default 5,         -- PI: pitch intelligence
  bunting         real not null default 5,
  fielding        real not null default 5,
  throw           real not null default 5,
  karma           real not null default 5,

  -- Training caps (max a skill can reach)
  improve_factor  real not null default 1,
  max_speed       real not null default 10,
  max_stamina     real not null default 10,
  range_ag        real not null default 10,
  max_eye         real not null default 10,
  max_avg         real not null default 10,
  max_strength    real not null default 10,
  range_dhr       real not null default 10,
  max_play_intel  real not null default 10,
  max_bunting     real not null default 10,
  max_fielding    real not null default 10,
  max_throw       real not null default 10,

  -- Training assignment (which skill slot is being trained, 0 = none)
  training_slot   int not null default 0,

  created_at      timestamptz not null default now()
);

create index idx_players_team on public.players(team_id);
create index idx_players_roster on public.players(roster_status);

-- ═══════════════════════════════════════════════════════════════════════
-- 4. SCHEDULES  (maps to Test_Schedule)
-- ═══════════════════════════════════════════════════════════════════════
create table public.schedules (
  id              bigint generated always as identity primary key,
  league_id       bigint not null references public.leagues(id) on delete cascade,
  home_team_id    bigint not null references public.teams(id) on delete cascade,
  visitor_team_id bigint not null references public.teams(id) on delete cascade,
  game_time       timestamptz not null,
  game_type       text not null default 'regular' check (game_type in ('regular','playoff','o2o')),
  played          boolean not null default false,
  season_no       int not null default 1,
  created_at      timestamptz not null default now()
);

create index idx_schedules_league on public.schedules(league_id);
create index idx_schedules_teams on public.schedules(home_team_id, visitor_team_id);
create index idx_schedules_unplayed on public.schedules(played) where played = false;

-- ═══════════════════════════════════════════════════════════════════════
-- 5. STANDINGS  (maps to US_MLB_Standings_League)
-- ═══════════════════════════════════════════════════════════════════════
create table public.standings (
  id            bigint generated always as identity primary key,
  league_id     bigint not null references public.leagues(id) on delete cascade,
  team_id       bigint not null references public.teams(id) on delete cascade,
  season_no     int not null default 1,
  w             int not null default 0,
  l             int not null default 0,

  -- Team cumulative hitting stats (from UpdateStats.teamHitting)
  ab            int not null default 0,
  r             int not null default 0,
  h             int not null default 0,
  b2            int not null default 0,  -- doubles
  b3            int not null default 0,  -- triples
  hr            int not null default 0,
  rbi           int not null default 0,
  bb            int not null default 0,
  so            int not null default 0,
  sb            int not null default 0,
  cs            int not null default 0,
  sf            int not null default 0,
  sac           int not null default 0,

  unique(league_id, team_id, season_no)
);

create index idx_standings_league on public.standings(league_id, season_no);

-- ═══════════════════════════════════════════════════════════════════════
-- 6. GAMES  (box score header — one row per completed game)
-- ═══════════════════════════════════════════════════════════════════════
create table public.games (
  id              bigint generated always as identity primary key,
  schedule_id     bigint references public.schedules(id) on delete set null,
  league_id       bigint not null references public.leagues(id) on delete cascade,
  home_team_id    bigint not null references public.teams(id),
  visitor_team_id bigint not null references public.teams(id),
  home_runs       int not null default 0,
  visitor_runs    int not null default 0,
  home_hits       int not null default 0,
  visitor_hits    int not null default 0,
  innings         int not null default 9,
  winning_team_id bigint references public.teams(id),
  losing_team_id  bigint references public.teams(id),

  -- Inning-by-inning linescore (JSONB arrays)
  home_linescore  jsonb,   -- e.g. [0,1,0,2,0,0,0,1,0]
  visitor_linescore jsonb,

  played_at       timestamptz not null default now()
);

create index idx_games_league on public.games(league_id);
create index idx_games_teams on public.games(home_team_id, visitor_team_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 7. GAME EVENTS  (play-by-play log for live viewer)
-- ═══════════════════════════════════════════════════════════════════════
create table public.game_events (
  id              bigint generated always as identity primary key,
  game_id         bigint not null references public.games(id) on delete cascade,
  seq             int not null,              -- ordering within game
  inning          int not null,
  half            text not null check (half in ('top','bottom')),
  outs            int not null,
  batter_name     text not null,
  pitcher_name    text not null,
  outcome         int not null,              -- AtBatOutcome enum (1-7)
  description     text,
  visitor_runs    int not null default 0,
  home_runs       int not null default 0,
  visitor_hits    int not null default 0,
  home_hits       int not null default 0,
  runners_scored  text[]                     -- array of player names
);

create index idx_game_events_game on public.game_events(game_id, seq);

-- ═══════════════════════════════════════════════════════════════════════
-- 8. PLAYER SEASON STATS — HITTERS  (maps to playerHitting in UpdateStats)
-- ═══════════════════════════════════════════════════════════════════════
create table public.player_stats_hitting (
  id          bigint generated always as identity primary key,
  player_id   bigint not null references public.players(id) on delete cascade,
  team_id     bigint not null references public.teams(id),
  season_no   int not null default 1,
  g           int not null default 0,
  ab          int not null default 0,
  r           int not null default 0,
  h           int not null default 0,
  b2          int not null default 0,
  b3          int not null default 0,
  hr          int not null default 0,
  rbi         int not null default 0,
  bb          int not null default 0,
  so          int not null default 0,
  sb          int not null default 0,
  cs          int not null default 0,
  sf          int not null default 0,
  sac         int not null default 0,

  unique(player_id, team_id, season_no)
);

create index idx_psh_player on public.player_stats_hitting(player_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 9. PLAYER SEASON STATS — PITCHERS  (maps to playerPitcher / teamPitching)
-- ═══════════════════════════════════════════════════════════════════════
create table public.player_stats_pitching (
  id          bigint generated always as identity primary key,
  player_id   bigint not null references public.players(id) on delete cascade,
  team_id     bigint not null references public.teams(id),
  season_no   int not null default 1,
  w           int not null default 0,
  l           int not null default 0,
  g           int not null default 0,
  gs          int not null default 0,
  cg          int not null default 0,
  sv          int not null default 0,
  svo         int not null default 0,
  sho         int not null default 0,
  ip          real not null default 0,
  bf          int not null default 0,
  h           int not null default 0,
  r           int not null default 0,
  er          int not null default 0,
  bb          int not null default 0,
  so          int not null default 0,
  ab          int not null default 0,
  b2          int not null default 0,
  b3          int not null default 0,
  hr          int not null default 0,

  unique(player_id, team_id, season_no)
);

create index idx_psp_player on public.player_stats_pitching(player_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 10. GAME-BY-GAME HITTER LINES  (maps to gameByGameHitters)
-- ═══════════════════════════════════════════════════════════════════════
create table public.game_stats_hitting (
  id          bigint generated always as identity primary key,
  game_id     bigint not null references public.games(id) on delete cascade,
  player_id   bigint not null references public.players(id) on delete cascade,
  team_id     bigint not null references public.teams(id),
  opp_team_id bigint not null references public.teams(id),
  bat_order   real not null default 0,
  position    text,
  game_type   text not null default 'regular',
  g           int not null default 1,
  ab          int not null default 0,
  r           int not null default 0,
  h           int not null default 0,
  b2          int not null default 0,
  b3          int not null default 0,
  hr          int not null default 0,
  rbi         int not null default 0,
  bb          int not null default 0,
  so          int not null default 0,
  sb          int not null default 0,
  cs          int not null default 0,
  sf          int not null default 0,
  sac         int not null default 0
);

create index idx_gsh_game on public.game_stats_hitting(game_id);
create index idx_gsh_player on public.game_stats_hitting(player_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 11. GAME-BY-GAME PITCHER LINES  (maps to gameByGamePitchers)
-- ═══════════════════════════════════════════════════════════════════════
create table public.game_stats_pitching (
  id            bigint generated always as identity primary key,
  game_id       bigint not null references public.games(id) on delete cascade,
  player_id     bigint not null references public.players(id) on delete cascade,
  team_id       bigint not null references public.teams(id),
  opp_team_id   bigint not null references public.teams(id),
  pitch_app     real not null default 0,
  game_type     text not null default 'regular',
  w             int not null default 0,
  l             int not null default 0,
  g             int not null default 1,
  gs            int not null default 0,
  cg            int not null default 0,
  sho           int not null default 0,
  sv            int not null default 0,
  ip            real not null default 0,
  ab            int not null default 0,
  r             int not null default 0,
  er            int not null default 0,
  h             int not null default 0,
  b2            int not null default 0,
  b3            int not null default 0,
  hr            int not null default 0,
  rbi           int not null default 0,
  bb            int not null default 0,
  so            int not null default 0
);

create index idx_gsp_game on public.game_stats_pitching(game_id);
create index idx_gsp_player on public.game_stats_pitching(player_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 12. TEAM BUDGETS  (new — Phase 10 finance)
-- ═══════════════════════════════════════════════════════════════════════
create table public.team_budgets (
  id          bigint generated always as identity primary key,
  team_id     bigint not null references public.teams(id) on delete cascade unique,
  balance     bigint not null default 5000000,  -- starting $5M
  updated_at  timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════════════
-- 13. FINANCIAL TRANSACTIONS  (income/expense log)
-- ═══════════════════════════════════════════════════════════════════════
create table public.financial_transactions (
  id            bigint generated always as identity primary key,
  team_id       bigint not null references public.teams(id) on delete cascade,
  type          text not null check (type in (
    'LGR_home','LGR_visitor','food_bev_souv','advertisment',
    'stadium_ops','player_sal','coaches_sal','pSold','pPurchased',
    'signing_bonus','trade_cash','other'
  )),
  amount        bigint not null,               -- positive = income, negative = expense
  description   text,
  reference_id  bigint,                        -- optional FK to game_id, trade_id, etc.
  created_at    timestamptz not null default now()
);

create index idx_ft_team on public.financial_transactions(team_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 14. TRADE LISTINGS  (free agent market + player sale board)
-- ═══════════════════════════════════════════════════════════════════════
create table public.trade_listings (
  id            bigint generated always as identity primary key,
  seller_team_id bigint not null references public.teams(id) on delete cascade,
  player_id     bigint not null references public.players(id) on delete cascade,
  asking_price  bigint not null default 0,     -- baseline: $22,000 × skill_sum
  status        text not null default 'active' check (status in ('active','sold','withdrawn')),
  created_at    timestamptz not null default now()
);

create index idx_tl_status on public.trade_listings(status) where status = 'active';

-- ═══════════════════════════════════════════════════════════════════════
-- 15. TRADE OFFERS  (bids on listings or direct offers)
-- ═══════════════════════════════════════════════════════════════════════
create table public.trade_offers (
  id              bigint generated always as identity primary key,
  listing_id      bigint references public.trade_listings(id) on delete set null,
  from_team_id    bigint not null references public.teams(id) on delete cascade,
  to_team_id      bigint not null references public.teams(id) on delete cascade,
  offered_player_ids bigint[],                 -- players offered in trade
  cash_amount     bigint not null default 0,
  status          text not null default 'pending' check (status in ('pending','accepted','rejected','withdrawn')),
  created_at      timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════════════
-- 16. TRANSACTIONS  (completed trades / signings log)
-- ═══════════════════════════════════════════════════════════════════════
create table public.transactions (
  id              bigint generated always as identity primary key,
  type            text not null check (type in ('trade','signing','release','waiver')),
  team_a_id       bigint references public.teams(id),
  team_b_id       bigint references public.teams(id),
  player_ids      bigint[],
  cash_amount     bigint default 0,
  details         jsonb,
  created_at      timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════════════
-- 17. CHALLENGE REQUESTS  (O2O challenges)
-- ═══════════════════════════════════════════════════════════════════════
create table public.challenge_requests (
  id                bigint generated always as identity primary key,
  challenger_team_id bigint not null references public.teams(id) on delete cascade,
  challenged_team_id bigint not null references public.teams(id) on delete cascade,
  wager             bigint not null default 0,
  status            text not null default 'pending' check (status in ('pending','accepted','declined','completed','expired')),
  game_id           bigint references public.games(id) on delete set null,
  created_at        timestamptz not null default now()
);

-- ═══════════════════════════════════════════════════════════════════════
-- 18. O2O RECORDS  (head-to-head history)
-- ═══════════════════════════════════════════════════════════════════════
create table public.o2o_records (
  id              bigint generated always as identity primary key,
  team_a_id       bigint not null references public.teams(id) on delete cascade,
  team_b_id       bigint not null references public.teams(id) on delete cascade,
  wins_a          int not null default 0,
  wins_b          int not null default 0,
  updated_at      timestamptz not null default now(),

  unique(team_a_id, team_b_id)
);

-- ═══════════════════════════════════════════════════════════════════════
-- 19. NOTIFICATIONS  (in-app alerts)
-- ═══════════════════════════════════════════════════════════════════════
create table public.notifications (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  type        text not null check (type in (
    'trade_offer','trade_accepted','trade_rejected',
    'challenge_received','challenge_accepted','challenge_declined',
    'game_result','system'
  )),
  payload     jsonb,
  read        boolean not null default false,
  created_at  timestamptz not null default now()
);

create index idx_notifications_user on public.notifications(user_id, read);

-- ═══════════════════════════════════════════════════════════════════════
-- 20. NAMES  (seed table for random player name generation)
-- ═══════════════════════════════════════════════════════════════════════
create table public.names (
  id          bigint generated always as identity primary key,
  row_num     int not null,
  first_name  text not null,
  last_name   text not null
);

create index idx_names_row on public.names(row_num);

-- ═══════════════════════════════════════════════════════════════════════
-- 21. ROW LEVEL SECURITY (RLS)
-- ═══════════════════════════════════════════════════════════════════════

-- Enable RLS on all tables
alter table public.leagues enable row level security;
alter table public.teams enable row level security;
alter table public.players enable row level security;
alter table public.schedules enable row level security;
alter table public.standings enable row level security;
alter table public.games enable row level security;
alter table public.game_events enable row level security;
alter table public.player_stats_hitting enable row level security;
alter table public.player_stats_pitching enable row level security;
alter table public.game_stats_hitting enable row level security;
alter table public.game_stats_pitching enable row level security;
alter table public.team_budgets enable row level security;
alter table public.financial_transactions enable row level security;
alter table public.trade_listings enable row level security;
alter table public.trade_offers enable row level security;
alter table public.transactions enable row level security;
alter table public.challenge_requests enable row level security;
alter table public.o2o_records enable row level security;
alter table public.notifications enable row level security;
alter table public.names enable row level security;

-- ─── Public read policies (anyone can see these) ────────────────────
create policy "leagues_read" on public.leagues for select using (true);
create policy "teams_read" on public.teams for select using (true);
create policy "players_read" on public.players for select using (true);
create policy "schedules_read" on public.schedules for select using (true);
create policy "standings_read" on public.standings for select using (true);
create policy "games_read" on public.games for select using (true);
create policy "game_events_read" on public.game_events for select using (true);
create policy "psh_read" on public.player_stats_hitting for select using (true);
create policy "psp_read" on public.player_stats_pitching for select using (true);
create policy "gsh_read" on public.game_stats_hitting for select using (true);
create policy "gsp_read" on public.game_stats_pitching for select using (true);
create policy "trade_listings_read" on public.trade_listings for select using (true);
create policy "transactions_read" on public.transactions for select using (true);
create policy "o2o_records_read" on public.o2o_records for select using (true);
create policy "names_read" on public.names for select using (true);

-- ─── Owner-only write policies (team owner can modify their own) ────
create policy "teams_owner_update" on public.teams for update
  using (owner_id = auth.uid());

create policy "players_owner_update" on public.players for update
  using (team_id in (select id from public.teams where owner_id = auth.uid()));

-- Budget: owner can read their own
create policy "budget_owner_read" on public.team_budgets for select
  using (team_id in (select id from public.teams where owner_id = auth.uid()));

-- Financial transactions: owner can read their own
create policy "ft_owner_read" on public.financial_transactions for select
  using (team_id in (select id from public.teams where owner_id = auth.uid()));

-- Trade offers: involved parties can read
create policy "trade_offers_read" on public.trade_offers for select
  using (
    from_team_id in (select id from public.teams where owner_id = auth.uid())
    or to_team_id in (select id from public.teams where owner_id = auth.uid())
  );

-- Trade offers: offering team can insert
create policy "trade_offers_insert" on public.trade_offers for insert
  with check (from_team_id in (select id from public.teams where owner_id = auth.uid()));

-- Trade offers: receiving team can update (accept/reject)
create policy "trade_offers_update" on public.trade_offers for update
  using (to_team_id in (select id from public.teams where owner_id = auth.uid()));

-- Challenge requests: involved parties can read
create policy "challenges_read" on public.challenge_requests for select
  using (
    challenger_team_id in (select id from public.teams where owner_id = auth.uid())
    or challenged_team_id in (select id from public.teams where owner_id = auth.uid())
  );

-- Challenge requests: challenger can insert
create policy "challenges_insert" on public.challenge_requests for insert
  with check (challenger_team_id in (select id from public.teams where owner_id = auth.uid()));

-- Challenge requests: challenged team can update (accept/decline)
create policy "challenges_update" on public.challenge_requests for update
  using (challenged_team_id in (select id from public.teams where owner_id = auth.uid()));

-- Notifications: user can only see their own
create policy "notifications_owner_read" on public.notifications for select
  using (user_id = auth.uid());

-- Notifications: user can mark their own as read
create policy "notifications_owner_update" on public.notifications for update
  using (user_id = auth.uid());

-- ─── Service-role policies (server-side workers can write everything) ──
-- The Supabase service_role key bypasses RLS by default.
-- These policies ensure the anon/authenticated roles can only do what's above.
-- All INSERT/UPDATE/DELETE for game results, stats, standings, etc. happen
-- server-side via service_role and are not exposed to the client.
