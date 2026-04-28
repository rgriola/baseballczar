/** Auto-generated types matching the Supabase schema in 001_initial_schema.sql */

export interface League {
  id: number;
  league_name: string;
  division: string;
  sub: string | null;
  season_no: number;
  max_teams: number;
  status: 'open' | 'full' | 'archived';
  created_at: string;
}

export interface Team {
  id: number;
  owner_id: string | null;
  league_id: number | null;
  team_name: string;
  country_id: number;
  next_sp_slot: number;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  street: string | null;
  street_2: string | null;
  city: string | null;
  zipcode: string | null;
  created_at: string;
}

export interface Player {
  id: number;
  team_id: number | null;
  first_name: string;
  last_name: string;
  jersey_no: number;
  position: string;
  roster_status: 'active' | 'reserve' | 'free_agent';
  fielder: boolean;
  batt_order: number;
  rotation_slot: number;
  age: number;
  salary: number;
  contract: number;
  height: number;
  weight: number;
  hand_throw: number;
  hand_batting: number;
  speed: number;
  stamina: number;
  ag: number;
  eye: number;
  avg: number;
  strength: number;
  dhr: number;
  play_intel: number;
  bunting: number;
  fielding: number;
  throw: number;
  karma: number;
  improve_factor: number;
  max_speed: number;
  max_stamina: number;
  range_ag: number;
  max_eye: number;
  max_avg: number;
  max_strength: number;
  range_dhr: number;
  max_play_intel: number;
  max_bunting: number;
  max_fielding: number;
  max_throw: number;
  training_slot: number;
  created_at: string;
}

export interface Schedule {
  id: number;
  league_id: number;
  home_team_id: number;
  visitor_team_id: number;
  game_time: string;
  game_type: 'regular' | 'playoff' | 'o2o';
  played: boolean;
  season_no: number;
  created_at: string;
}

export interface Standing {
  id: number;
  league_id: number;
  team_id: number;
  season_no: number;
  w: number;
  l: number;
  ab: number;
  r: number;
  h: number;
  b2: number;
  b3: number;
  hr: number;
  rbi: number;
  bb: number;
  so: number;
  sb: number;
  cs: number;
  sf: number;
  sac: number;
}

export interface Game {
  id: number;
  schedule_id: number | null;
  league_id: number;
  home_team_id: number;
  visitor_team_id: number;
  home_runs: number;
  visitor_runs: number;
  home_hits: number;
  visitor_hits: number;
  innings: number;
  winning_team_id: number | null;
  losing_team_id: number | null;
  home_linescore: number[] | null;
  visitor_linescore: number[] | null;
  played_at: string;
}

export interface GameEvent {
  id: number;
  game_id: number;
  seq: number;
  inning: number;
  half: 'top' | 'bottom';
  outs: number;
  batter_name: string;
  pitcher_name: string;
  outcome: number;
  description: string | null;
  visitor_runs: number;
  home_runs: number;
  visitor_hits: number;
  home_hits: number;
  runners_scored: string[] | null;
  hit_zone: string | null;
}

export interface PlayerStatsHitting {
  id: number;
  player_id: number;
  team_id: number;
  season_no: number;
  g: number;
  ab: number;
  r: number;
  h: number;
  b2: number;
  b3: number;
  hr: number;
  rbi: number;
  bb: number;
  so: number;
  sb: number;
  cs: number;
  sf: number;
  sac: number;
}

export interface PlayerStatsPitching {
  id: number;
  player_id: number;
  team_id: number;
  season_no: number;
  w: number;
  l: number;
  g: number;
  gs: number;
  cg: number;
  sv: number;
  svo: number;
  sho: number;
  ip: number;
  bf: number;
  h: number;
  r: number;
  er: number;
  bb: number;
  so: number;
  ab: number;
  b2: number;
  b3: number;
  hr: number;
}

export interface TeamBudget {
  id: number;
  team_id: number;
  balance: number;
  updated_at: string;
}

export interface FinancialTransaction {
  id: number;
  team_id: number;
  type: 'LGR_home' | 'LGR_visitor' | 'food_bev_souv' | 'advertisment' |
    'stadium_ops' | 'player_sal' | 'coaches_sal' | 'pSold' | 'pPurchased' |
    'signing_bonus' | 'trade_cash' | 'other';
  amount: number;
  description: string | null;
  reference_id: number | null;
  created_at: string;
}

export interface TradeListing {
  id: number;
  seller_team_id: number;
  player_id: number;
  asking_price: number;
  status: 'active' | 'sold' | 'withdrawn';
  created_at: string;
}

export interface TradeOffer {
  id: number;
  listing_id: number | null;
  from_team_id: number;
  to_team_id: number;
  offered_player_ids: number[] | null;
  cash_amount: number;
  status: 'pending' | 'accepted' | 'rejected' | 'withdrawn';
  created_at: string;
}

export interface Transaction {
  id: number;
  type: 'trade' | 'signing' | 'release' | 'waiver';
  team_a_id: number | null;
  team_b_id: number | null;
  player_ids: number[] | null;
  cash_amount: number;
  details: Record<string, unknown> | null;
  created_at: string;
}

export interface ChallengeRequest {
  id: number;
  challenger_team_id: number;
  challenged_team_id: number;
  wager: number;
  status: 'pending' | 'accepted' | 'declined' | 'completed' | 'expired';
  game_id: number | null;
  created_at: string;
}

export interface O2ORecord {
  id: number;
  team_a_id: number;
  team_b_id: number;
  wins_a: number;
  wins_b: number;
  updated_at: string;
}

export interface Notification {
  id: number;
  user_id: string;
  type: 'trade_offer' | 'trade_accepted' | 'trade_rejected' |
    'challenge_received' | 'challenge_accepted' | 'challenge_declined' |
    'game_result' | 'system';
  payload: Record<string, unknown> | null;
  read: boolean;
  created_at: string;
}

export interface Name {
  id: number;
  row_num: number;
  first_name: string;
  last_name: string;
}
