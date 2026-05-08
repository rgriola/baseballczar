// Last touched by agent: 2026-05-07T23:55:00Z
/**
 * Persist per-game and per-season player stats to Supabase.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type { GameStats, PitcherBoxLine } from '../sim-engine/types';

/** Convert total outs to baseball IP notation (20 outs = 6.2) */
export function outsToIp(outs: number): number {
  return Math.floor(outs / 3) + (outs % 3) * 0.1;
}

export function buildHitterGameRows(
  gameId: number | null,
  statsMap: Map<number, GameStats>,
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
      ab: stats.ab,
      r: stats.r,
      h: stats.hits,
      b2: stats.b2,
      b3: stats.b3,
      hr: stats.hr,
      rbi: stats.rbi,
      bb: stats.bb,
      so: stats.so,
      sb: 0,
      cs: 0,
      sf: 0,
      sac: 0,
    });
  }
  return rows;
}

export function buildPitcherGameRows(
  gameId: number | null,
  statsMap: Map<number, PitcherBoxLine>,
  meta: Map<number, { teamId: number }>,
  oppTeamId: number,
  gameType: string,
) {
  const rows: Record<string, unknown>[] = [];
  for (const [playerId, stats] of Array.from(statsMap.entries())) {
    if (stats.g === 0) continue;
    const m = meta.get(playerId);
    if (!m) continue;
    rows.push({
      ...(gameId != null ? { game_id: gameId } : {}),
      player_id: playerId,
      team_id: m.teamId,
      opp_team_id: oppTeamId,
      pitch_app: stats.g,
      game_type: gameType,
      w: stats.w,
      l: stats.l,
      g: stats.g,
      gs: stats.gs,
      cg: stats.cg,
      sho: stats.sho,
      sv: stats.sv,
      ip: outsToIp(stats.om),
      ab: stats.bf - stats.bb,
      r: stats.r,
      er: stats.er,
      h: stats.h,
      b2: 0,
      b3: 0,
      hr: stats.hr,
      rbi: 0,
      bb: stats.bb,
      so: stats.so,
    });
  }
  return rows;
}

export function buildSeasonHitterRows(
  statsMap: Map<number, GameStats>,
  meta: Map<number, { teamId: number; position: string; batOrder: number }>,
  seasonNo: number,
) {
  const rows: Record<string, unknown>[] = [];
  for (const [playerId, stats] of Array.from(statsMap.entries())) {
    const m = meta.get(playerId);
    if (!m) continue;
    rows.push({
      player_id: playerId,
      team_id: m.teamId,
      season_no: seasonNo,
      g: 1,
      ab: stats.ab,
      r: stats.r,
      h: stats.hits,
      b2: stats.b2,
      b3: stats.b3,
      hr: stats.hr,
      rbi: stats.rbi,
      bb: stats.bb,
      so: stats.so,
    });
  }
  return rows;
}

export function buildSeasonPitcherRows(
  statsMap: Map<number, PitcherBoxLine>,
  meta: Map<number, { teamId: number }>,
  seasonNo: number,
) {
  const rows: Record<string, unknown>[] = [];
  for (const [playerId, stats] of Array.from(statsMap.entries())) {
    if (stats.g === 0) continue;
    const m = meta.get(playerId);
    if (!m) continue;
    rows.push({
      player_id: playerId,
      team_id: m.teamId,
      season_no: seasonNo,
      w: stats.w,
      l: stats.l,
      g: stats.g,
      gs: stats.gs,
      cg: stats.cg,
      sv: stats.sv,
      sho: stats.sho,
      ip: outsToIp(stats.om),
      bf: stats.bf,
      h: stats.h,
      r: stats.r,
      er: stats.er,
      bb: stats.bb,
      so: stats.so,
      hr: stats.hr,
    });
  }
  return rows;
}

export async function upsertSeasonHitterStats(
  supabase: SupabaseClient,
  statsMap: Map<number, GameStats>,
  meta: Map<number, { teamId: number; position: string; batOrder: number }>,
  seasonNo: number,
) {
  const rows = buildSeasonHitterRows(statsMap, meta, seasonNo);
  if (rows.length === 0) return;

  const { error } = await supabase.rpc('batch_upsert_season_hitting', {
    p_stats: rows,
  });
  if (error) throw new Error(`batch_upsert_season_hitting failed: ${error.message}`);
}

export async function upsertSeasonPitcherStats(
  supabase: SupabaseClient,
  statsMap: Map<number, PitcherBoxLine>,
  meta: Map<number, { teamId: number }>,
  seasonNo: number,
) {
  const rows = buildSeasonPitcherRows(statsMap, meta, seasonNo);
  if (rows.length === 0) return;

  const { error } = await supabase.rpc('batch_upsert_season_pitching', {
    p_stats: rows,
  });
  if (error) throw new Error(`batch_upsert_season_pitching failed: ${error.message}`);
}
