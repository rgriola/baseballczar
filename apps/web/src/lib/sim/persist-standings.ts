// Last touched by agent: 2026-05-07T23:55:00Z
/**
 * Persist standings updates after a game via upsert_standing RPC.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type { GameResult, GameStats, PitcherBoxLine } from '../sim-engine/types';

export interface StandingDelta {
  leagueId: number;
  teamId: number;
  seasonNo: number;
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
  eraRuns: number;
  eraOuts: number;
}

function sumHitting(statsMap: Map<number, GameStats>) {
  let ab = 0, r = 0, h = 0, b2 = 0, b3 = 0, hr = 0, rbi = 0, bb = 0, so = 0;
  for (const s of Array.from(statsMap.values())) {
    ab += s.ab; r += s.r; h += s.hits; b2 += s.b2; b3 += s.b3;
    hr += s.hr; rbi += s.rbi; bb += s.bb; so += s.so;
  }
  return { ab, r, h, b2, b3, hr, rbi, bb, so };
}

function sumPitching(statsMap: Map<number, PitcherBoxLine>) {
  let er = 0, outs = 0;
  for (const s of Array.from(statsMap.values())) {
    er += s.er; outs += s.om;
  }
  return { er, outs };
}

function buildStandingDelta(
  teamId: number,
  isWinner: boolean,
  hit: ReturnType<typeof sumHitting>,
  pitch: ReturnType<typeof sumPitching>,
  opts: { leagueId: number; seasonNo: number },
): StandingDelta {
  return {
    leagueId: opts.leagueId,
    teamId,
    seasonNo: opts.seasonNo,
    w: isWinner ? 1 : 0,
    l: isWinner ? 0 : 1,
    ab: hit.ab,
    r: hit.r,
    h: hit.h,
    b2: hit.b2,
    b3: hit.b3,
    hr: hit.hr,
    rbi: hit.rbi,
    bb: hit.bb,
    so: hit.so,
    eraRuns: pitch.er,
    eraOuts: pitch.outs,
  };
}

export function buildStandingsDeltas(
  result: GameResult,
  opts: { leagueId: number; seasonNo: number },
): { home: StandingDelta; visitor: StandingDelta } {
  const homeHit = sumHitting(result.homePlayerStats);
  const visitorHit = sumHitting(result.visitorPlayerStats);
  const homePitch = sumPitching(result.homePitcherStats);
  const visitorPitch = sumPitching(result.visitorPitcherStats);

  const winnerId = result.winningTeamId;
  const homeIsWinner = result.homeTeamId === winnerId;

  return {
    home: buildStandingDelta(result.homeTeamId, homeIsWinner, homeHit, homePitch, opts),
    visitor: buildStandingDelta(result.visitorTeamId, !homeIsWinner, visitorHit, visitorPitch, opts),
  };
}

async function upsertStandingDelta(supabase: SupabaseClient, delta: StandingDelta): Promise<void> {
  const { error } = await supabase.rpc('upsert_standing', {
    p_league_id: delta.leagueId,
    p_team_id: delta.teamId,
    p_season_no: delta.seasonNo,
    p_w: delta.w,
    p_l: delta.l,
    p_ab: delta.ab,
    p_r: delta.r,
    p_h: delta.h,
    p_b2: delta.b2,
    p_b3: delta.b3,
    p_hr: delta.hr,
    p_rbi: delta.rbi,
    p_bb: delta.bb,
    p_so: delta.so,
    p_era_runs: delta.eraRuns,
    p_era_outs: delta.eraOuts,
  });
  if (error) throw new Error(`upsert_standing failed for team ${delta.teamId}: ${error.message}`);
}

export async function updateStandings(
  supabase: SupabaseClient,
  result: GameResult,
  opts: { leagueId: number; seasonNo: number },
) {
  const deltas = buildStandingsDeltas(result, opts);
  await upsertStandingDelta(supabase, deltas.home);
  await upsertStandingDelta(supabase, deltas.visitor);
}
