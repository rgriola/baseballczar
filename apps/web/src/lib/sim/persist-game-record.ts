// Last touched by agent: 2026-05-06T15:02:00Z
/**
 * Persist the game box score and play-by-play events to Supabase.
 */
import { SupabaseClient } from '@supabase/supabase-js';
import type { GameResult } from '../sim-engine/types';

interface GameRecordOpts {
  scheduleId: number;
  leagueId: number;
}

/**
 * Insert the game row and all associated play-by-play events.
 * Returns the new game ID.
 */
export async function insertGameRecord(
  supabase: SupabaseClient,
  result: GameResult,
  opts: GameRecordOpts,
): Promise<number> {
  const { data: game, error: gameErr } = await supabase
    .from('games')
    .insert({
      schedule_id: opts.scheduleId,
      league_id: opts.leagueId,
      home_team_id: result.homeTeamId,
      visitor_team_id: result.visitorTeamId,
      home_runs: result.homeRuns,
      visitor_runs: result.visitorRuns,
      home_hits: result.homeHits,
      visitor_hits: result.visitorHits,
      home_errors: result.scoreBoard.home.totalErrors,
      visitor_errors: result.scoreBoard.visitor.totalErrors,
      innings: result.innings,
      winning_team_id: result.winningTeamId,
      losing_team_id: result.losingTeamId,
      // Persist only played innings (1..N) to avoid 34-column linescore rendering.
      home_linescore: result.scoreBoard.home.runs.slice(1, result.innings + 1),
      visitor_linescore: result.scoreBoard.visitor.runs.slice(1, result.innings + 1),
    })
    .select('id')
    .single();

  if (gameErr || !game) {
    throw new Error(`Failed to insert game: ${gameErr?.message}`);
  }

  const gameId = game.id;

  if (result.events.length > 0) {
    const eventInserts = result.events.map((e, i) => ({
      game_id: gameId,
      seq: i + 1,
      inning: e.inning,
      half: e.half,
      outs: e.outs,
      batter_name: e.batterName,
      pitcher_name: e.pitcherName,
      outcome: e.outcome,
      description: e.description,
      visitor_runs: e.visitorRuns,
      home_runs: e.homeRuns,
      visitor_hits: e.visitorHits,
      home_hits: e.homeHits,
      runners_scored: e.runnersScored,
      hit_zone: e.hitZone ?? null,
      spray_angle_deg: e.sprayAngleDeg ?? null,
      launch_angle_deg: e.launchAngleDeg ?? null,
      exit_velo_mph: e.exitVeloMph ?? null,
      ball_path_waypoints: e.ballPathWaypoints ?? null,
      base_occupancy_before: e.baseOccupancyBefore ?? null,
      base_occupancy_after: e.baseOccupancyAfter ?? null,
    }));

    const BATCH = 200;
    for (let i = 0; i < eventInserts.length; i += BATCH) {
      const batch = eventInserts.slice(i, i + BATCH);
      const { error } = await supabase.from('game_events').insert(batch);
      if (error) throw new Error(`Failed to insert events batch: ${error.message}`);
    }
  }

  return gameId;
}
