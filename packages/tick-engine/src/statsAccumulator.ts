/**
 * StatsAccumulator — single source of truth for all in-game stat tracking.
 *
 * Extracted from gameOrchestrator.ts to prevent stat bugs caused by
 * interleaved stat mutations and `continue` statements bypassing recording.
 *
 * Usage:
 *   const acc = new StatsAccumulator(homeTeam, awayTeam, homeDefense, awayDefense);
 *   acc.recordNonBattedBallAB(ab, pitcherId, runsScored, scoredRunnerIds, preRunners, postRunners);
 *   acc.recordBattedBallAB(ab, pitcherId, tickResult, runsScored, scoredRunnerIds, defenseMap);
 *   acc.recordStealAttempt(playerId, success);
 *   const gameResult = acc.toGameResult(homeTeam, awayTeam, innings, homeScore, awayScore);
 */
import type {
  AtBatRecord, AtBatResult, Player, Team, GameResult, Position,
  BatterGameStats, PitcherGameStats, FielderGameStats,
} from '@baseballczar/sim-engine';

// ─── Helpers ─────────────────────────────────────────────────────

function isHitResult(r: AtBatResult): boolean {
  return r === 'single' || r === 'double' || r === 'triple' || r === 'home-run' || r === 'base-hit';
}

function isOutResult(r: AtBatResult): boolean {
  return r === 'ground-out' || r === 'fly-out' || r === 'line-out' || r === 'pop-out' ||
    r === 'foul-out' || r === 'strikeout' || r === 'double-play' ||
    r === 'fielders-choice' || r === 'sac-fly';
}

// ─── StatsAccumulator ────────────────────────────────────────────

export class StatsAccumulator {
  private readonly batterStats = new Map<number, BatterGameStats>();
  private readonly pitcherStats = new Map<number, PitcherGameStats>();
  private readonly fielderStats = new Map<number, FielderGameStats>();

  /**
   * Runners who reached base on errors — their runs are unearned.
   * Cleared when the runner scores.
   */
  private readonly unearnedRunnerIds = new Set<number>();

  /**
   * Maps runner ID → the pitcher who was on the mound when they reached base.
   * Used to charge runs to the correct pitcher even after a pitching change.
   */
  private readonly runnerResponsiblePitcher = new Map<number, number>();

  constructor(
    homeTeam: Team,
    awayTeam: Team,
    homeDefense: Map<Position, Player>,
    awayDefense: Map<Position, Player>,
  ) {
    // Pre-initialize stats for all roster players
    for (const p of homeTeam.lineup) this.getBS(p.id);
    for (const p of awayTeam.lineup) this.getBS(p.id);
    for (const [pos, player] of homeDefense) this.getFS(player.id, pos);
    for (const [pos, player] of awayDefense) this.getFS(player.id, pos);
  }

  // ── Accessors (get-or-create) ───────────────────────────────────

  getBS(id: number): BatterGameStats {
    let s = this.batterStats.get(id);
    if (!s) {
      s = {
        batterId: id, pa: 0, ab: 0, hits: 0, doubles: 0, triples: 0,
        homeRuns: 0, walks: 0, strikeouts: 0, runs: 0, rbis: 0, sb: 0, cs: 0,
        putouts: 0, assists: 0, errors: 0,
        battedBalls: 0, totalEV: 0, totalLA: 0, totalSpray: 0, totalBatSpeed: 0,
      };
      this.batterStats.set(id, s);
    }
    return s;
  }

  getPS(id: number): PitcherGameStats {
    let s = this.pitcherStats.get(id);
    if (!s) {
      s = {
        pitcherId: id, battersFaced: 0, pitches: 0, outs: 0, hits: 0,
        runs: 0, earnedRuns: 0, walks: 0, strikeouts: 0, homeRuns: 0,
        putouts: 0, assists: 0, errors: 0, totalMph: 0,
      };
      this.pitcherStats.set(id, s);
    }
    return s;
  }

  getFS(id: number, pos: Position): FielderGameStats {
    let s = this.fielderStats.get(id);
    if (!s) {
      s = { playerId: id, position: pos, putouts: 0, assists: 0, errors: 0 };
      this.fielderStats.set(id, s);
    }
    return s;
  }

  /** Initialize a pitcher's stats when they enter the game. */
  initPitcher(id: number): void {
    this.getPS(id);
  }

  // ── Non-batted-ball ABs (K, BB, HBP) ───────────────────────────

  /**
   * Record stats for an at-bat that was resolved without contact
   * (strikeout, walk, HBP). Called from the `continue` path in the orchestrator.
   */
  recordNonBattedBallAB(
    ab: AtBatRecord,
    currentPitcherId: number,
    runsScored: number,
    preRunnerIds: number[],
    postRunnerIds: Set<number>,
  ): void {
    const result = ab.result;

    // Batter stats
    const bs = this.getBS(ab.batter.id);
    bs.pa++;
    if (result !== 'walk' && result !== 'hbp' && result !== 'sac-fly') bs.ab++;
    if (result === 'walk') bs.walks++;
    if (result === 'strikeout') bs.strikeouts++;
    bs.rbis += runsScored;

    // Credit runs to scored runners
    if (runsScored > 0) {
      for (const runnerId of preRunnerIds) {
        if (!postRunnerIds.has(runnerId)) {
          this.creditRunScored(runnerId, currentPitcherId);
        }
      }
    }

    // Pitcher stats
    const ps = this.getPS(currentPitcherId);
    ps.battersFaced++;
    ps.pitches += ab.pitches.length;
    if (result === 'strikeout') { ps.outs++; ps.strikeouts++; }
    if (result === 'walk' || result === 'hbp') ps.walks++;

    // Pitcher analytics — sum pitch velocities
    for (const pitch of ab.pitches) {
      ps.totalMph += pitch.mph;
    }

    // Track runner responsibility for walks/HBP
    if (result === 'walk' || result === 'hbp') {
      this.runnerResponsiblePitcher.set(ab.batter.id, currentPitcherId);
    }
  }

  // ── Batted-ball ABs (hits, outs, errors) ────────────────────────

  /**
   * Record stats for an at-bat resolved through the tick engine
   * (contact was made, ball was fielded, outcome determined by physics).
   */
  recordBattedBallAB(
    ab: AtBatRecord,
    currentPitcherId: number,
    tickResult: AtBatResult,
    runsScored: number,
    scoredRunnerIds: number[],
    defenseMap: Map<Position, Player>,
  ): void {
    // Batter stats
    const bs = this.getBS(ab.batter.id);
    bs.pa++;
    if (tickResult !== 'walk' && tickResult !== 'hbp' && tickResult !== 'sac-fly') bs.ab++;
    if (isHitResult(tickResult)) bs.hits++;
    if (tickResult === 'double') bs.doubles++;
    if (tickResult === 'triple') bs.triples++;
    if (tickResult === 'home-run') bs.homeRuns++;
    if (tickResult === 'walk') bs.walks++;
    if (tickResult === 'strikeout') bs.strikeouts++;
    bs.rbis += runsScored;

    // Credit runs to each runner who scored
    for (const scoredId of scoredRunnerIds) {
      this.creditRunScored(scoredId, currentPitcherId);
    }

    // Batter analytics — accumulate from fair batted balls
    if (ab.battedBall && !ab.battedBall.isFoul) {
      bs.battedBalls++;
      bs.totalEV += ab.battedBall.exitVeloMph;
      bs.totalLA += ab.battedBall.launchAngleDeg;
      bs.totalSpray += ab.battedBall.sprayAngleDeg;
      bs.totalBatSpeed += ab.battedBall.batSpeedMph ?? 0;
    }

    // Pitcher stats — charge to CURRENT pitcher
    const ps = this.getPS(currentPitcherId);
    ps.battersFaced++;
    ps.pitches += ab.pitches.length;
    if (isOutResult(tickResult)) ps.outs += tickResult === 'double-play' ? 2 : 1;
    if (isHitResult(tickResult)) ps.hits++;
    if (tickResult === 'home-run') ps.homeRuns++;
    if (tickResult === 'walk' || tickResult === 'hbp') ps.walks++;
    if (tickResult === 'strikeout') ps.strikeouts++;

    // Pitcher analytics — sum pitch velocities
    for (const pitch of ab.pitches) {
      ps.totalMph += pitch.mph;
    }

    // Mark runner who reached on error as unearned
    if (tickResult === 'reached-on-error') {
      this.unearnedRunnerIds.add(ab.batter.id);
    }

    // Track which pitcher is responsible for each new baserunner
    if (isHitResult(tickResult) || tickResult === 'walk' || tickResult === 'hbp' || tickResult === 'reached-on-error') {
      this.runnerResponsiblePitcher.set(ab.batter.id, currentPitcherId);
    }

    // Fielding credits (PO/A/E)
    if (ab.fielding) {
      this.recordFieldingCredits(ab.fielding, defenseMap);
    }
  }

  // ── Stolen bases ────────────────────────────────────────────────

  recordStealAttempt(playerId: number, success: boolean): void {
    const bs = this.getBS(playerId);
    if (success) bs.sb++;
    else bs.cs++;
  }

  // ── Fielding credits ────────────────────────────────────────────

  private recordFieldingCredits(
    fielding: NonNullable<AtBatRecord['fielding']>,
    defenseMap: Map<Position, Player>,
  ): void {
    const bump = (pos: Position, field: 'putouts' | 'assists' | 'errors') => {
      const player = defenseMap.get(pos);
      if (!player) return;
      const fs = this.getFS(player.id, pos);
      fs[field]++;
      // Also credit on the unified batter/pitcher stat line
      const bsf = this.batterStats.get(player.id);
      if (bsf) bsf[field]++;
      const psf = this.pitcherStats.get(player.id);
      if (psf) psf[field]++;
    };
    if (fielding.putoutBy) bump(fielding.putoutBy, 'putouts');
    if (fielding.extraPutouts) for (const p of fielding.extraPutouts) bump(p, 'putouts');
    if (fielding.assistBy) for (const p of fielding.assistBy) bump(p, 'assists');
    if (fielding.errorBy) bump(fielding.errorBy, 'errors');
  }

  // ── Run scoring (earned/unearned logic) ─────────────────────────

  private creditRunScored(runnerId: number, fallbackPitcherId: number): void {
    this.getBS(runnerId).runs++;
    const responsiblePitcherId = this.runnerResponsiblePitcher.get(runnerId) ?? fallbackPitcherId;
    const responsiblePS = this.getPS(responsiblePitcherId);
    responsiblePS.runs++;
    if (this.unearnedRunnerIds.has(runnerId)) {
      this.unearnedRunnerIds.delete(runnerId);
    } else {
      responsiblePS.earnedRuns++;
    }
    this.runnerResponsiblePitcher.delete(runnerId);
  }

  // ── Output ──────────────────────────────────────────────────────

  /** Build the final GameResult from accumulated stats. */
  toGameResult(
    homeTeam: Team,
    awayTeam: Team,
    innings: number,
    homeScore: number,
    awayScore: number,
    atBats: AtBatRecord[],
  ): GameResult {
    return {
      homeTeam,
      awayTeam,
      homeRuns: homeScore,
      awayRuns: awayScore,
      innings,
      atBats,
      batterStats: this.batterStats,
      pitcherStats: this.pitcherStats,
      fielderStats: this.fielderStats,
    };
  }

  // ── Read-only accessors for external use ────────────────────────

  getBatterStatsMap(): ReadonlyMap<number, BatterGameStats> {
    return this.batterStats;
  }

  getPitcherStatsMap(): ReadonlyMap<number, PitcherGameStats> {
    return this.pitcherStats;
  }

  getFielderStatsMap(): ReadonlyMap<number, FielderGameStats> {
    return this.fielderStats;
  }
}

export { isHitResult, isOutResult };
