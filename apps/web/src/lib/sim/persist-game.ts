// Last touched by agent: 2026-05-07T23:55:00Z
/**
 * Persist a simulated game result to Supabase.
 *
 * Writes to: games, game_events, game_stats_hitting, game_stats_pitching,
 * player_stats_hitting, player_stats_pitching, standings, schedules,
 * team_budgets, financial_transactions.
 *
 * Sub-modules: persist-game-record, persist-player-stats, persist-standings, persist-revenue.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { assertGameResultContract, type ScheduledGameContract } from './game-result-contract';
import { buildGameEventRows, buildGameInsertRow } from './persist-game-record';
import type { RosterSnapshot } from './simulate-scheduled-game';
import {
  buildHitterGameRows,
  buildPitcherGameRows,
  buildSeasonHitterRows,
  buildSeasonPitcherRows,
} from './persist-player-stats';
import { buildStandingsDeltas } from './persist-standings';
import { buildRevenueBundle } from './persist-revenue';

interface PersistOptions {
  scheduleId: number;
  leagueId: number;
  seasonNo: number;
  gameType: 'regular' | 'playoff' | 'o2o';
  homeHitterMeta: Map<number, { teamId: number; position: string; batOrder: number }>;
  visitorHitterMeta: Map<number, { teamId: number; position: string; batOrder: number }>;
  homePitcherMeta: Map<number, { teamId: number }>;
  visitorPitcherMeta: Map<number, { teamId: number }>;
  homeRosterSnapshot?: RosterSnapshot;
  visitorRosterSnapshot?: RosterSnapshot;
}

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

  const gameRow = buildGameInsertRow(result, {
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

  const eventRows = buildGameEventRows(result);

  const gameHittingRows = [
    ...buildHitterGameRows(null, result.homePlayerStats, opts.homeHitterMeta, result.visitorTeamId, opts.gameType),
    ...buildHitterGameRows(null, result.visitorPlayerStats, opts.visitorHitterMeta, result.homeTeamId, opts.gameType),
  ];

  const gamePitchingRows = [
    ...buildPitcherGameRows(null, result.homePitcherStats, opts.homePitcherMeta, result.visitorTeamId, opts.gameType),
    ...buildPitcherGameRows(null, result.visitorPitcherStats, opts.visitorPitcherMeta, result.homeTeamId, opts.gameType),
  ];

  const seasonHittingRows = [
    ...buildSeasonHitterRows(result.homePlayerStats, opts.homeHitterMeta, opts.seasonNo),
    ...buildSeasonHitterRows(result.visitorPlayerStats, opts.visitorHitterMeta, opts.seasonNo),
  ];

  const seasonPitchingRows = [
    ...buildSeasonPitcherRows(result.homePitcherStats, opts.homePitcherMeta, opts.seasonNo),
    ...buildSeasonPitcherRows(result.visitorPitcherStats, opts.visitorPitcherMeta, opts.seasonNo),
  ];

  const standings = buildStandingsDeltas(result, {
    leagueId: opts.leagueId,
    seasonNo: opts.seasonNo,
  });

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