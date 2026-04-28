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
import type { GameResult } from '../sim-engine/types';
import { insertGameRecord } from './persist-game-record';
import {
  buildHitterGameRows,
  buildPitcherGameRows,
  upsertSeasonHitterStats,
  upsertSeasonPitcherStats,
} from './persist-player-stats';
import { updateStandings } from './persist-standings';
import { processRevenue } from './persist-revenue';

interface PersistOptions {
  scheduleId: number;
  leagueId: number;
  seasonNo: number;
  gameType: 'regular' | 'playoff' | 'o2o';
  homeHitterMeta: Map<number, { teamId: number; position: string; batOrder: number }>;
  visitorHitterMeta: Map<number, { teamId: number; position: string; batOrder: number }>;
  homePitcherMeta: Map<number, { teamId: number }>;
  visitorPitcherMeta: Map<number, { teamId: number }>;
}

export async function persistGameResult(
  supabase: SupabaseClient,
  result: GameResult,
  opts: PersistOptions,
): Promise<number> {
  // 1. Insert game box score + play-by-play events
  const gameId = await insertGameRecord(supabase, result, opts);

  // 2. Insert game-by-game hitter stats
  const hitterRows = [
    ...buildHitterGameRows(gameId, result.homePlayerStats, opts.homeHitterMeta, result.visitorTeamId, opts.gameType),
    ...buildHitterGameRows(gameId, result.visitorPlayerStats, opts.visitorHitterMeta, result.homeTeamId, opts.gameType),
  ];
  if (hitterRows.length > 0) {
    const { error } = await supabase.from('game_stats_hitting').insert(hitterRows);
    if (error) throw new Error(`Failed to insert hitter game stats: ${error.message}`);
  }

  // 3. Insert game-by-game pitcher stats
  const pitcherRows = [
    ...buildPitcherGameRows(gameId, result.homePitcherStats, opts.homePitcherMeta, result.visitorTeamId, opts.gameType),
    ...buildPitcherGameRows(gameId, result.visitorPitcherStats, opts.visitorPitcherMeta, result.homeTeamId, opts.gameType),
  ];
  if (pitcherRows.length > 0) {
    const { error } = await supabase.from('game_stats_pitching').insert(pitcherRows);
    if (error) throw new Error(`Failed to insert pitcher game stats: ${error.message}`);
  }

  // 4. Upsert season stats (batch RPC)
  await upsertSeasonHitterStats(supabase, result.homePlayerStats, opts.homeHitterMeta, opts.seasonNo);
  await upsertSeasonHitterStats(supabase, result.visitorPlayerStats, opts.visitorHitterMeta, opts.seasonNo);
  await upsertSeasonPitcherStats(supabase, result.homePitcherStats, opts.homePitcherMeta, opts.seasonNo);
  await upsertSeasonPitcherStats(supabase, result.visitorPitcherStats, opts.visitorPitcherMeta, opts.seasonNo);

  // 5. Update standings
  await updateStandings(supabase, result, opts);

  // 6. Mark schedule as played
  await supabase
    .from('schedules')
    .update({ played: true })
    .eq('id', opts.scheduleId);

  // 7. Process gate receipts
  await processRevenue(supabase, gameId, result, opts);

  return gameId;
}