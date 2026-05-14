// Last touched by agent: 2026-05-14T09:45:00Z
/**
 * Persist a simulated game result to Supabase.
 *
 * Writes to: games, game_events, hitter_game_stats, pitcher_game_stats,
 * hitter_season_stats, pitcher_season_stats, standings, schedules,
 * team_budgets, financial_transactions.
 *
 * Sub-modules: persist-game-record, persist-player-stats, persist-standings, persist-revenue.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type { GameResult, BatterGameStats, PitcherGameStats } from '@baseballczar/sim-engine';
import { assertGameResultContract, type ScheduledGameContract } from './game-result-contract';
import { buildGameEventRows, buildGameInsertRow, buildLinescore } from './persist-game-record';
import type { RosterSnapshot } from './simulate-scheduled-game';
import {
  buildHitterGameRows,
  buildPitcherGameRows,
  buildSeasonHitterRows,
  buildSeasonPitcherRows,
} from './persist-player-stats';
import { buildStandingsDeltas } from './persist-standings';
import { buildRevenueBundle } from './persist-revenue';
import { determinePitcherRoles } from './pitcher-roles';

interface PersistOptions {
  scheduleId: number;
  leagueId: number;
  seasonNo: number;
  gameType: string;
  homeHitterMeta: Map<number, { teamId: number; position: string; batOrder: number }>;
  visitorHitterMeta: Map<number, { teamId: number; position: string; batOrder: number }>;
  homePitcherMeta: Map<number, { teamId: number }>;
  visitorPitcherMeta: Map<number, { teamId: number }>;
  homeRosterSnapshot?: RosterSnapshot;
  visitorRosterSnapshot?: RosterSnapshot;
}

// ── Stat splitting ───────────────────────────────────────────────

/**
 * Split the unified batterStats/pitcherStats maps by team using roster membership.
 * The engine produces one big map — persistence needs home vs away.
 */
function splitBatterStats(
  allStats: Map<number, BatterGameStats>,
  homePlayerIds: Set<number>,
): { home: Map<number, BatterGameStats>; away: Map<number, BatterGameStats> } {
  const home = new Map<number, BatterGameStats>();
  const away = new Map<number, BatterGameStats>();
  for (const [id, stats] of allStats) {
    if (homePlayerIds.has(id)) home.set(id, stats);
    else away.set(id, stats);
  }
  return { home, away };
}

function splitPitcherStats(
  allStats: Map<number, PitcherGameStats>,
  homePlayerIds: Set<number>,
): { home: Map<number, PitcherGameStats>; away: Map<number, PitcherGameStats> } {
  const home = new Map<number, PitcherGameStats>();
  const away = new Map<number, PitcherGameStats>();
  for (const [id, stats] of allStats) {
    if (homePlayerIds.has(id)) home.set(id, stats);
    else away.set(id, stats);
  }
  return { home, away };
}

// ── Persistence entry point ──────────────────────────────────────

const PERSIST_BOUNDARY_STEPS = ['persist-sim-game-transaction'] as const;

type PersistBoundaryStep = typeof PERSIST_BOUNDARY_STEPS[number];

async function runBoundaryStep<T>(step: PersistBoundaryStep, task: () => Promise<T>): Promise<T> {
  try {
    return await task();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`[persistGameResult:${step}] ${message}`);
  }
}

export async function persistGameResult(
  supabase: SupabaseClient,
  contract: ScheduledGameContract,
  opts: PersistOptions,
): Promise<number> {
  const { result, meta } = contract;
  assertGameResultContract(result);

  // Build home player ID set from roster
  const homePlayerIds = new Set<number>();
  for (const p of result.homeTeam.lineup) homePlayerIds.add(p.id);
  for (const p of result.homeTeam.rotation) homePlayerIds.add(p.id);
  for (const p of result.homeTeam.bullpen) homePlayerIds.add(p.id);

  // Split unified stats into home/away
  const batterSplit = splitBatterStats(result.batterStats, homePlayerIds);
  const pitcherSplit = splitPitcherStats(result.pitcherStats, homePlayerIds);

  // Build linescores from atBats
  const homeLinescore = buildLinescore(result.atBats, result.innings, 'bottom');
  const visitorLinescore = buildLinescore(result.atBats, result.innings, 'top');

  const gameRow = buildGameInsertRow(result, homeLinescore, visitorLinescore, {
    scheduleId: opts.scheduleId,
    leagueId: opts.leagueId,
    provenance: {
      simSeed: meta.seed,
      simVersion: meta.simVersion,
      simConfigVersion: meta.configVersion,
    },
    homeRosterSnapshot: opts.homeRosterSnapshot,
    visitorRosterSnapshot: opts.visitorRosterSnapshot,
  });

  const eventRows = buildGameEventRows(result.atBats);

  const gameHittingRows = [
    ...buildHitterGameRows(null, batterSplit.home, opts.homeHitterMeta, result.awayTeam.id, opts.gameType),
    ...buildHitterGameRows(null, batterSplit.away, opts.visitorHitterMeta, result.homeTeam.id, opts.gameType),
  ];

  // Determine W/L/SV for pitchers
  const pitcherRoles = determinePitcherRoles(result, homePlayerIds);

  const gamePitchingRows = [
    ...buildPitcherGameRows(null, pitcherSplit.home, opts.homePitcherMeta, result.awayTeam.id, opts.gameType, pitcherRoles),
    ...buildPitcherGameRows(null, pitcherSplit.away, opts.visitorPitcherMeta, result.homeTeam.id, opts.gameType, pitcherRoles),
  ];

  const seasonHittingRows = [
    ...buildSeasonHitterRows(batterSplit.home, opts.homeHitterMeta, opts.seasonNo, opts.leagueId),
    ...buildSeasonHitterRows(batterSplit.away, opts.visitorHitterMeta, opts.seasonNo, opts.leagueId),
  ];

  const seasonPitchingRows = [
    ...buildSeasonPitcherRows(pitcherSplit.home, opts.homePitcherMeta, opts.seasonNo, opts.leagueId, pitcherRoles),
    ...buildSeasonPitcherRows(pitcherSplit.away, opts.visitorPitcherMeta, opts.seasonNo, opts.leagueId, pitcherRoles),
  ];

  const standings = buildStandingsDeltas(
    result,
    batterSplit.home, batterSplit.away,
    pitcherSplit.home, pitcherSplit.away,
    { leagueId: opts.leagueId, seasonNo: opts.seasonNo },
  );

  const homeStandingDelta = {
    league_id: standings.home.leagueId,
    team_id: standings.home.teamId,
    season_no: standings.home.seasonNo,
    w: standings.home.w,
    l: standings.home.l,
    ab: standings.home.ab,
    r: standings.home.r,
    h: standings.home.h,
    b2: standings.home.b2,
    b3: standings.home.b3,
    hr: standings.home.hr,
    rbi: standings.home.rbi,
    bb: standings.home.bb,
    so: standings.home.so,
    era_runs: standings.home.eraRuns,
    era_outs: standings.home.eraOuts,
    p_ip: standings.home.pIp,
    p_h: standings.home.pH,
    p_r: standings.home.pR,
    p_er: standings.home.pEr,
    p_bb: standings.home.pBb,
    p_so: standings.home.pSo,
    p_hr: standings.home.pHr,
  };

  const visitorStandingDelta = {
    league_id: standings.visitor.leagueId,
    team_id: standings.visitor.teamId,
    season_no: standings.visitor.seasonNo,
    w: standings.visitor.w,
    l: standings.visitor.l,
    ab: standings.visitor.ab,
    r: standings.visitor.r,
    h: standings.visitor.h,
    b2: standings.visitor.b2,
    b3: standings.visitor.b3,
    hr: standings.visitor.hr,
    rbi: standings.visitor.rbi,
    bb: standings.visitor.bb,
    so: standings.visitor.so,
    era_runs: standings.visitor.eraRuns,
    era_outs: standings.visitor.eraOuts,
    p_ip: standings.visitor.pIp,
    p_h: standings.visitor.pH,
    p_r: standings.visitor.pR,
    p_er: standings.visitor.pEr,
    p_bb: standings.visitor.pBb,
    p_so: standings.visitor.pSo,
    p_hr: standings.visitor.pHr,
  };

  const revenue = buildRevenueBundle(result, opts.gameType);

  const gameId = await runBoundaryStep('persist-sim-game-transaction', async () => {
    const { data, error } = await supabase.rpc('persist_sim_game_transaction', {
      p_schedule_id: opts.scheduleId,
      p_game_row: gameRow,
      p_event_rows: eventRows,
      p_game_hitting_rows: gameHittingRows,
      p_game_pitching_rows: gamePitchingRows,
      p_season_hitting_rows: seasonHittingRows,
      p_season_pitching_rows: seasonPitchingRows,
      p_home_standing_delta: homeStandingDelta,
      p_visitor_standing_delta: visitorStandingDelta,
      p_financial_rows: revenue.transactions,
      p_home_credit_amount: revenue.homeCreditAmount,
      p_visitor_credit_amount: revenue.visitorCreditAmount,
    });

    if (error) {
      throw new Error(`persist_sim_game_transaction failed: ${error.message}`);
    }

    const parsed = Number(data);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      throw new Error(`persist_sim_game_transaction returned invalid game id: ${String(data)}`);
    }

    return parsed;
  });

  return gameId;
}