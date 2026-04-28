/**
 * Persist standings updates after a game via upsert_standing RPC.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type { GameResult, GameStats, PitcherBoxLine } from '../sim-engine/types';

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

export async function updateStandings(
  supabase: SupabaseClient,
  result: GameResult,
  opts: { leagueId: number; seasonNo: number },
) {
  const homeHit = sumHitting(result.homePlayerStats);
  const visitorHit = sumHitting(result.visitorPlayerStats);
  const homePitch = sumPitching(result.homePitcherStats);
  const visitorPitch = sumPitching(result.visitorPitcherStats);

  const winnerId = result.winningTeamId;
  const homeIsWinner = result.homeTeamId === winnerId;

  async function upsertTeam(teamId: number, isWinner: boolean, hit: typeof homeHit, pitch: typeof homePitch) {
    const { error } = await supabase.rpc('upsert_standing', {
      p_league_id: opts.leagueId,
      p_team_id: teamId,
      p_season_no: opts.seasonNo,
      p_w: isWinner ? 1 : 0,
      p_l: isWinner ? 0 : 1,
      p_ab: hit.ab,
      p_r: hit.r,
      p_h: hit.h,
      p_b2: hit.b2,
      p_b3: hit.b3,
      p_hr: hit.hr,
      p_rbi: hit.rbi,
      p_bb: hit.bb,
      p_so: hit.so,
      p_era_runs: pitch.er,
      p_era_outs: pitch.outs,
    });
    if (error) throw new Error(`upsert_standing failed for team ${teamId}: ${error.message}`);
  }

  await upsertTeam(result.homeTeamId, homeIsWinner, homeHit, homePitch);
  await upsertTeam(result.visitorTeamId, !homeIsWinner, visitorHit, visitorPitch);
}
