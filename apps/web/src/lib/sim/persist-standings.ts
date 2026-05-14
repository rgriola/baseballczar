// Last touched by agent: 2026-05-14T09:43:00Z
/**
 * Persist standings updates after a game.
 * Reads directly from engine types (BatterGameStats, PitcherGameStats).
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type { BatterGameStats, PitcherGameStats, GameResult } from '@baseballczar/sim-engine';

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
  // Team pitching totals
  pIp: number;
  pH: number;
  pR: number;
  pEr: number;
  pBb: number;
  pSo: number;
  pHr: number;
}

function sumBatterHitting(statsMap: Map<number, BatterGameStats>) {
  let ab = 0, r = 0, h = 0, b2 = 0, b3 = 0, hr = 0, rbi = 0, bb = 0, so = 0;
  for (const s of Array.from(statsMap.values())) {
    ab += s.ab; r += s.runs; h += s.hits; b2 += s.doubles; b3 += s.triples;
    hr += s.homeRuns; rbi += s.rbis; bb += s.walks; so += s.strikeouts;
  }
  return { ab, r, h, b2, b3, hr, rbi, bb, so };
}

function sumPitching(statsMap: Map<number, PitcherGameStats>) {
  let er = 0, outs = 0, h = 0, r = 0, bb = 0, so = 0, hr = 0;
  for (const s of Array.from(statsMap.values())) {
    er += s.earnedRuns; outs += s.outs; h += s.hits; r += s.runs;
    bb += s.walks; so += s.strikeouts; hr += s.homeRuns;
  }
  return { er, outs, h, r, bb, so, hr };
}

function buildStandingDelta(
  teamId: number,
  isWinner: boolean,
  hit: ReturnType<typeof sumBatterHitting>,
  pitch: ReturnType<typeof sumPitching>,
  opts: { leagueId: number; seasonNo: number },
): StandingDelta {
  const ipWhole = Math.floor(pitch.outs / 3);
  const ipFrac = (pitch.outs % 3) * 0.1;
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
    pIp: ipWhole + ipFrac,
    pH: pitch.h,
    pR: pitch.r,
    pEr: pitch.er,
    pBb: pitch.bb,
    pSo: pitch.so,
    pHr: pitch.hr,
  };
}

/**
 * Build standings deltas from an engine GameResult.
 * Requires pre-split batter/pitcher stat maps per team.
 */
export function buildStandingsDeltas(
  result: GameResult,
  homeBatterStats: Map<number, BatterGameStats>,
  awayBatterStats: Map<number, BatterGameStats>,
  homePitcherStats: Map<number, PitcherGameStats>,
  awayPitcherStats: Map<number, PitcherGameStats>,
  opts: { leagueId: number; seasonNo: number },
): { home: StandingDelta; visitor: StandingDelta } {
  const homeHit = sumBatterHitting(homeBatterStats);
  const visitorHit = sumBatterHitting(awayBatterStats);
  const homePitch = sumPitching(homePitcherStats);
  const visitorPitch = sumPitching(awayPitcherStats);

  const homeIsWinner = result.homeRuns > result.awayRuns;

  return {
    home: buildStandingDelta(result.homeTeam.id, homeIsWinner, homeHit, homePitch, opts),
    visitor: buildStandingDelta(result.awayTeam.id, !homeIsWinner, visitorHit, visitorPitch, opts),
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
  homeBatterStats: Map<number, BatterGameStats>,
  awayBatterStats: Map<number, BatterGameStats>,
  homePitcherStats: Map<number, PitcherGameStats>,
  awayPitcherStats: Map<number, PitcherGameStats>,
  opts: { leagueId: number; seasonNo: number },
) {
  const deltas = buildStandingsDeltas(result, homeBatterStats, awayBatterStats, homePitcherStats, awayPitcherStats, opts);
  await upsertStandingDelta(supabase, deltas.home);
  await upsertStandingDelta(supabase, deltas.visitor);
}
