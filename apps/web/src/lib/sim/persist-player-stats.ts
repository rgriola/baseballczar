// Last touched by agent: 2026-05-14T09:43:00Z
/**
 * Persist per-game and per-season player stats to Supabase.
 * Reads directly from engine types (BatterGameStats, PitcherGameStats).
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type { BatterGameStats, PitcherGameStats } from '@baseballczar/sim-engine';

/** Convert total outs to baseball IP notation (20 outs = 6.2) */
export function outsToIp(outs: number): number {
  return Math.floor(outs / 3) + (outs % 3) * 0.1;
}

export function buildHitterGameRows(
  gameId: number | null,
  statsMap: Map<number, BatterGameStats>,
  meta: Map<number, { teamId: number; position: string; batOrder: number }>,
  oppTeamId: number,
  gameType: string,
) {
  const rows: Record<string, unknown>[] = [];
  for (const [playerId, stats] of Array.from(statsMap.entries())) {
    const m = meta.get(playerId);
    if (!m) continue;
    rows.push({
      ...(gameId != null ? { game_id: gameId } : {}),
      player_id: playerId,
      team_id: m.teamId,
      opp_team_id: oppTeamId,
      bat_order: m.batOrder,
      position: m.position,
      game_type: gameType,
      g: 1,
      pa: stats.pa,
      ab: stats.ab,
      r: stats.runs,
      h: stats.hits,
      b2: stats.doubles,
      b3: stats.triples,
      hr: stats.homeRuns,
      rbi: stats.rbis,
      bb: stats.walks,
      so: stats.strikeouts,
      sb: stats.sb,
      cs: stats.cs,
      sf: 0,
      sac: 0,
      // Fielding
      putouts: stats.putouts,
      assists: stats.assists,
      errors: stats.errors,
      // Analytics accumulators
      batted_balls: stats.battedBalls,
      total_ev: stats.totalEV,
      total_la: stats.totalLA,
      total_spray: stats.totalSpray,
      total_bat_speed: stats.totalBatSpeed,
    });
  }
  return rows;
}

export function buildPitcherGameRows(
  gameId: number | null,
  statsMap: Map<number, PitcherGameStats>,
  meta: Map<number, { teamId: number }>,
  oppTeamId: number,
  gameType: string,
  pitcherRoles?: Map<number, { isStarter: boolean; isWinner: boolean; isLoser: boolean; isSave: boolean }>,
) {
  const rows: Record<string, unknown>[] = [];
  for (const [playerId, stats] of Array.from(statsMap.entries())) {
    if (stats.battersFaced === 0) continue;
    const m = meta.get(playerId);
    if (!m) continue;
    const role = pitcherRoles?.get(playerId);
    rows.push({
      ...(gameId != null ? { game_id: gameId } : {}),
      player_id: playerId,
      team_id: m.teamId,
      opp_team_id: oppTeamId,
      pitch_app: 1,
      game_type: gameType,
      w: role?.isWinner ? 1 : 0,
      l: role?.isLoser ? 1 : 0,
      g: 1,
      gs: role?.isStarter ? 1 : 0,
      cg: 0,   // TODO: compute from game context
      sho: 0,  // TODO: compute from game context
      sv: role?.isSave ? 1 : 0,
      ip: outsToIp(stats.outs),
      ab: stats.battersFaced - stats.walks,
      r: stats.runs,
      er: stats.earnedRuns,
      h: stats.hits,
      b2: 0,
      b3: 0,
      hr: stats.homeRuns,
      rbi: 0,
      bb: stats.walks,
      so: stats.strikeouts,
      // Fielding
      putouts: stats.putouts,
      assists: stats.assists,
      errors: stats.errors,
      // Analytics accumulators
      pitches: stats.pitches,
      total_mph: stats.totalMph,
    });
  }
  return rows;
}

export function buildSeasonHitterRows(
  statsMap: Map<number, BatterGameStats>,
  meta: Map<number, { teamId: number; position: string; batOrder: number }>,
  seasonNo: number,
  leagueId: number,
) {
  const rows: Record<string, unknown>[] = [];
  for (const [playerId, stats] of Array.from(statsMap.entries())) {
    const m = meta.get(playerId);
    if (!m) continue;
    rows.push({
      player_id: playerId,
      team_id: m.teamId,
      league_id: leagueId,
      season_no: seasonNo,
      g: 1,
      pa: stats.pa,
      ab: stats.ab,
      r: stats.runs,
      h: stats.hits,
      b2: stats.doubles,
      b3: stats.triples,
      hr: stats.homeRuns,
      rbi: stats.rbis,
      bb: stats.walks,
      so: stats.strikeouts,
      sb: stats.sb,
      cs: stats.cs,
      // Fielding
      putouts: stats.putouts,
      assists: stats.assists,
      errors: stats.errors,
      // Analytics accumulators
      batted_balls: stats.battedBalls,
      total_ev: stats.totalEV,
      total_la: stats.totalLA,
      total_spray: stats.totalSpray,
      total_bat_speed: stats.totalBatSpeed,
    });
  }
  return rows;
}

export function buildSeasonPitcherRows(
  statsMap: Map<number, PitcherGameStats>,
  meta: Map<number, { teamId: number }>,
  seasonNo: number,
  leagueId: number,
  pitcherRoles?: Map<number, { isStarter: boolean; isWinner: boolean; isLoser: boolean; isSave: boolean }>,
) {
  const rows: Record<string, unknown>[] = [];
  for (const [playerId, stats] of Array.from(statsMap.entries())) {
    if (stats.battersFaced === 0) continue;
    const m = meta.get(playerId);
    if (!m) continue;
    const role = pitcherRoles?.get(playerId);
    rows.push({
      player_id: playerId,
      team_id: m.teamId,
      league_id: leagueId,
      season_no: seasonNo,
      w: role?.isWinner ? 1 : 0,
      l: role?.isLoser ? 1 : 0,
      g: 1,
      gs: role?.isStarter ? 1 : 0,
      cg: 0,
      sv: role?.isSave ? 1 : 0,
      sho: 0,
      ip: outsToIp(stats.outs),
      bf: stats.battersFaced,
      h: stats.hits,
      r: stats.runs,
      er: stats.earnedRuns,
      bb: stats.walks,
      so: stats.strikeouts,
      hr: stats.homeRuns,
      // Fielding
      putouts: stats.putouts,
      assists: stats.assists,
      errors: stats.errors,
      // Analytics accumulators
      pitches: stats.pitches,
      total_mph: stats.totalMph,
    });
  }
  return rows;
}

export async function upsertSeasonHitterStats(
  supabase: SupabaseClient,
  statsMap: Map<number, BatterGameStats>,
  meta: Map<number, { teamId: number; position: string; batOrder: number }>,
  seasonNo: number,
  leagueId: number,
) {
  const rows = buildSeasonHitterRows(statsMap, meta, seasonNo, leagueId);
  if (rows.length === 0) return;

  const { error } = await supabase.rpc('batch_upsert_season_hitting', {
    p_stats: rows,
  });
  if (error) throw new Error(`batch_upsert_season_hitting failed: ${error.message}`);
}

export async function upsertSeasonPitcherStats(
  supabase: SupabaseClient,
  statsMap: Map<number, PitcherGameStats>,
  meta: Map<number, { teamId: number }>,
  seasonNo: number,
  leagueId: number,
) {
  const rows = buildSeasonPitcherRows(statsMap, meta, seasonNo, leagueId);
  if (rows.length === 0) return;

  const { error } = await supabase.rpc('batch_upsert_season_pitching', {
    p_stats: rows,
  });
  if (error) throw new Error(`batch_upsert_season_pitching failed: ${error.message}`);
}
