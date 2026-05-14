// Last touched by agent: 2026-05-14T09:44:00Z
/**
 * Persist the game box score and play-by-play events to Supabase.
 * Reads directly from engine types (GameResult, AtBatRecord).
 */
import { SupabaseClient } from '@supabase/supabase-js';
import type { GameResult, AtBatRecord, BatterGameStats } from '@baseballczar/sim-engine';
import type { RosterSnapshot } from './simulate-scheduled-game';

export interface GameRecordProvenance {
  simSeed: number;
  simVersion: string;
  simConfigVersion: string;
}

export interface GameRecordOpts {
  scheduleId: number;
  leagueId: number;
  provenance?: GameRecordProvenance;
  homeRosterSnapshot?: RosterSnapshot;
  visitorRosterSnapshot?: RosterSnapshot;
}

// ── Linescore builder ────────────────────────────────────────────

export interface Linescore {
  runs: number[];   // 1-indexed: runs[1] = inning 1 runs, runs[0] unused
  hits: number[];
  errors: number[];
  totalRuns: number;
  totalHits: number;
  totalErrors: number;
}

/**
 * Derive per-inning linescore from AtBatRecord[].
 * Each AtBatRecord has `inning` (1-based) and half ('top' | 'bottom').
 */
export function buildLinescore(
  atBats: AtBatRecord[],
  innings: number,
  half: 'top' | 'bottom',
): Linescore {
  const runs = new Array(innings + 1).fill(0);
  const hits = new Array(innings + 1).fill(0);
  const errors = new Array(innings + 1).fill(0);

  for (const ab of atBats) {
    // Filter to this team's half-innings
    // Home bats bottom, visitor bats top
    if (ab.half !== half) continue;
    if (ab.inning < 1 || ab.inning > innings) continue;

    runs[ab.inning] += ab.runsScored;

    const r = ab.result;
    if (r === 'single' || r === 'double' || r === 'triple' || r === 'home-run' || r === 'base-hit') {
      hits[ab.inning]++;
    }

    // Count errors from fielding
    if (ab.fielding?.errorBy) {
      errors[ab.inning]++;
    }
  }

  const totalRuns = runs.reduce((a, b) => a + b, 0);
  const totalHits = hits.reduce((a, b) => a + b, 0);
  const totalErrors = errors.reduce((a, b) => a + b, 0);

  return { runs, hits, errors, totalRuns, totalHits, totalErrors };
}

// ── Game event builder ───────────────────────────────────────────

/**
 * Convert AtBatRecord[] into game_events DB rows.
 * This replaces the legacy GameEvent[] that the adapter used to produce.
 */
/**
 * Map engine AtBatResult strings to the legacy integer outcome codes
 * stored in the game_events.outcome DB column.
 * Legacy enum: Single=1, Double=2, Triple=3, HomeRun=4, Walk=5, GroundOut=6, Strikeout=7
 */
function resultToOutcomeInt(result: string): number {
  switch (result) {
    case 'single':
    case 'base-hit':       return 1;  // Single
    case 'double':         return 2;  // Double
    case 'triple':         return 3;  // Triple
    case 'home-run':       return 4;  // HomeRun
    case 'walk':
    case 'hbp':            return 5;  // Walk
    case 'ground-out':
    case 'fly-out':
    case 'line-out':
    case 'pop-out':
    case 'foul-out':
    case 'double-play':
    case 'fielders-choice':
    case 'sac-fly':
    case 'reached-on-error': return 6;  // GroundOut (generic out)
    case 'strikeout':      return 7;  // Strikeout
    default:               return 6;  // fallback → out
  }
}

export function buildGameEventRows(atBats: AtBatRecord[]): Record<string, unknown>[] {
  let homeRuns = 0;
  let visitorRuns = 0;
  let homeHits = 0;
  let visitorHits = 0;

  return atBats.map((ab, i) => {
    const isHome = ab.half === 'bottom';

    const isHit = ab.result === 'single' || ab.result === 'double' ||
      ab.result === 'triple' || ab.result === 'home-run' || ab.result === 'base-hit';

    if (isHome) {
      homeRuns += ab.runsScored;
      if (isHit) homeHits++;
    } else {
      visitorRuns += ab.runsScored;
      if (isHit) visitorHits++;
    }

    return {
      seq: i + 1,
      inning: ab.inning,
      half: ab.half,
      outs: ab.outs,
      batter_name: ab.batter.lastName,
      pitcher_name: ab.pitcher.lastName,
      outcome: resultToOutcomeInt(ab.result),
      description: ab.result,
      visitor_runs: visitorRuns,
      home_runs: homeRuns,
      visitor_hits: visitorHits,
      home_hits: homeHits,
      runners_scored: [],
      hit_zone: null,
      spray_angle_deg: ab.battedBall?.sprayAngleDeg ?? null,
      launch_angle_deg: ab.battedBall?.launchAngleDeg ?? null,
      exit_velo_mph: ab.battedBall?.exitVeloMph ?? null,
      ball_path_waypoints: null,
      base_occupancy_before: null,
      base_occupancy_after: null,
    };
  });
}

// ── Game insert row ──────────────────────────────────────────────

export function buildGameInsertRow(
  result: GameResult,
  homeLinescore: Linescore,
  visitorLinescore: Linescore,
  opts: GameRecordOpts,
): Record<string, unknown> {
  return {
    schedule_id: opts.scheduleId,
    league_id: opts.leagueId,
    home_team_id: result.homeTeam.id,
    visitor_team_id: result.awayTeam.id,
    home_runs: result.homeRuns,
    visitor_runs: result.awayRuns,
    home_hits: homeLinescore.totalHits,
    visitor_hits: visitorLinescore.totalHits,
    home_errors: visitorLinescore.totalErrors,   // errors by FIELDING team (visitor fields when home bats)
    visitor_errors: homeLinescore.totalErrors,    // errors by FIELDING team (home fields when visitor bats)
    innings: result.innings,
    winning_team_id: result.homeRuns > result.awayRuns ? result.homeTeam.id : result.awayTeam.id,
    losing_team_id: result.homeRuns > result.awayRuns ? result.awayTeam.id : result.homeTeam.id,
    home_linescore: homeLinescore.runs.slice(1, result.innings + 1),
    visitor_linescore: visitorLinescore.runs.slice(1, result.innings + 1),
    sim_seed: opts.provenance?.simSeed ?? null,
    sim_version: opts.provenance?.simVersion ?? null,
    sim_config_version: opts.provenance?.simConfigVersion ?? null,
    home_roster_snapshot: opts.homeRosterSnapshot ?? null,
    visitor_roster_snapshot: opts.visitorRosterSnapshot ?? null,
  };
}

/**
 * Insert the game row and all associated play-by-play events.
 * Returns the new game ID.
 */
export async function insertGameRecord(
  supabase: SupabaseClient,
  result: GameResult,
  homeLinescore: Linescore,
  visitorLinescore: Linescore,
  opts: GameRecordOpts,
): Promise<number> {
  const { data: game, error: gameErr } = await supabase
    .from('games')
    .insert(buildGameInsertRow(result, homeLinescore, visitorLinescore, opts))
    .select('id')
    .single();

  if (gameErr || !game) {
    throw new Error(`Failed to insert game: ${gameErr?.message}`);
  }

  const gameId = game.id;

  const eventInserts = buildGameEventRows(result.atBats);
  if (eventInserts.length > 0) {
    const BATCH = 200;
    for (let i = 0; i < eventInserts.length; i += BATCH) {
      const batch = eventInserts.slice(i, i + BATCH);
      const { error } = await supabase.from('game_events').insert(batch.map((row) => ({
        game_id: gameId,
        ...row,
      })));
      if (error) throw new Error(`Failed to insert events batch: ${error.message}`);
    }
  }

  return gameId;
}
