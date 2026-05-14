/**
 * Throw target + cutoff decision AI.
 *
 * Determines WHERE a fielder should throw the ball and whether
 * a cutoff man should let the throw through or redirect it.
 */
import type { BallEntity, FielderEntity, RunnerEntity, Point2D } from '../entities';
import type { Position } from '@baseballczar/sim-engine';
import { dist2D, COLLIDERS } from '../spatial';
import { BASE_POS } from '../runnerAI';
import { closestBaseTo, baseIndex, type GameSituation } from './types';

// ─── Throw target decision ──────────────────────────────────────

interface ThrowTarget {
  base: string;          // 'first', 'second', 'third', 'home'
  point: Point2D;        // exact target coordinates
  priority: number;      // higher = more urgent
  reason: string;        // for debugging / PBP
}

/**
 * Decide where a fielder should throw the ball.
 *
 * Evaluates each runner and determines the most valuable throw
 * target based on:
 *   - Lead runner priority (throw ahead of the runner)
 *   - Runner distance from the next base
 *   - Throw distance from fielder to base
 *   - Out situation (2 outs = any out matters)
 */
export function decideThrowTarget(
  fielder: FielderEntity,
  runners: RunnerEntity[],
  situation: GameSituation,
): ThrowTarget {
  const movingRunners = runners.filter((r): r is RunnerEntity & {
    state: { type: 'running'; from: Point2D; to: Point2D }
  } => r.state.type === 'running');

  if (movingRunners.length === 0) {
    // No runners moving — no active play.
    // Outfielders relay the ball to 2B (standard baseball convention).
    const isOutfielder = ['LF', 'CF', 'RF'].includes(fielder.position);
    if (isOutfielder) {
      return {
        base: 'second',
        point: BASE_POS.second,
        priority: 1,  // low priority but still triggers a throw
        reason: 'relay to 2B (no play)',
      };
    }
    return {
      base: closestBaseTo(fielder.pos),
      point: BASE_POS[closestBaseTo(fielder.pos)],
      priority: 0,
      reason: 'no immediate play',
    };
  }

  // Which base is the fielder already standing on (within 10 ft)?
  const fielderBase = closestBaseTo(fielder.pos);
  const fielderOnBase = dist2D(fielder.pos, BASE_POS[fielderBase]) < 10;

  // ── 3-OUT CHECK ─────────────────────────────────────────────────
  // If 3 outs are already recorded this half-inning, hold the ball.
  // No further throws — the play is dead.
  if (situation.outs >= 3) {
    return {
      base: fielderBase,
      point: BASE_POS[fielderBase],
      priority: 0,
      reason: '3 outs recorded — play dead',
    };
  }

  const targets: ThrowTarget[] = [];

  for (const runner of movingRunners) {
    // Where is this runner heading?
    const targetBase = closestBaseTo(runner.state.to);
    const runnerTarget = BASE_POS[targetBase];

    // If the fielder is ALREADY at this base, they don't need to throw.
    // They just need to step on the bag / tag the runner.
    if (fielderOnBase && targetBase === fielderBase) {
      // Return priority 0 — signal that the fielder should HOLD, not throw
      continue;
    }

    const throwDist = dist2D(fielder.pos, runnerTarget);
    const runnerDist = dist2D(runner.pos, runnerTarget);

    // Can we beat the runner there?
    const throwTime = throwDist / Math.max(1, fielder.throwVeloFps);
    const runnerTime = runnerDist / Math.max(1, runner.speedFps);
    const canBeat = throwTime < runnerTime + 0.2;
    const startedFromHome = dist2D(runner.state.from, BASE_POS.home) < 12;

    // Is this runner FORCED to advance? (someone behind them pushing)
    // Batter-runner to 1B is always a force. Other runners are forced only
    // if the base behind them is occupied (chain from batter).
    const origins = new Set(movingRunners.map(r => closestBaseTo(r.state.from)));
    const runnerFrom = closestBaseTo(runner.state.from);
    const isForcePlay = startedFromHome  // batter → 1B is always a force
      || (runnerFrom === 'first' && origins.has('home'))               // R1 forced by batter
      || (runnerFrom === 'second' && origins.has('first') && origins.has('home'))  // R2 forced by R1+batter
      || (runnerFrom === 'third' && origins.has('second') && origins.has('first') && origins.has('home'));  // R3 forced by chain

    // Priority: baseball progression first (lead runner / force), then beatability.
    let priority = 0;

    // Lead runner bonus (closer to scoring = higher priority)
    const basePriority: Record<string, number> = {
      home: 10,
      third: 7,
      second: 4,
      first: 2,
    };
    priority += basePriority[targetBase] ?? 1;

    // Batter-runner force at 1B is the default infield progression.
    if (targetBase === 'first' && startedFromHome) {
      priority += 5;
    }

    // Force play at 2B for lead runner from 1B.
    if (targetBase === 'second' && !startedFromHome) {
      priority += 2;
    }

    // NON-FORCE PENALTY: throwing to a base where the runner isn't
    // forced means a TAG play (risky). Heavily penalize vs the guaranteed
    // force out at 1B. E.g. R2 advancing to 3B on a grounder — no force
    // at 3B, so always take the easy out at 1B instead.
    if (!isForcePlay) {
      priority -= 8;
    }

    // Can-beat bonus
    if (canBeat) priority += 4;
    else priority -= 1;

    // Two-out bonus (any out is valuable)
    if (situation.outs === 2) priority += 2;

    // Close game bonus
    if (Math.abs(situation.scoreDiff) <= 2) priority += 2;

    targets.push({
      base: targetBase,
      point: runnerTarget,
      priority,
      reason: `${targetBase} (runner ${canBeat ? 'beatable' : 'safe'}${isForcePlay ? ', force' : ', tag'})`,
      _isForce: isForcePlay,
      _throwDist: throwDist,
    } as ThrowTarget & { _isForce: boolean; _throwDist: number });
  }

  // ── 2-OUT EASY FORCE OVERRIDE ───────────────────────────────────
  // With 2 outs, ANY force out ends the inning. Don't try for the lead
  // runner at home or third — take the EASIEST force out (shortest throw).
  // This prevents the 2B from throwing home when 1B is the trivial 3rd out.
  if (situation.outs >= 2 && targets.length > 0) {
    const forceTargets = (targets as (ThrowTarget & { _isForce?: boolean; _throwDist?: number })[])
      .filter(t => t._isForce);
    if (forceTargets.length > 0) {
      // Sort by throw distance — closest = easiest = most reliable
      forceTargets.sort((a, b) => (a._throwDist ?? 999) - (b._throwDist ?? 999));
      const best = forceTargets[0];
      return {
        base: best.base,
        point: best.point,
        priority: best.priority + 20,  // boost to ensure this is picked
        reason: `${best.base} (2-out easy force — shortest throw)`,
      };
    }
  }

  // Sort by priority, highest first
  targets.sort((a, b) => b.priority - a.priority);

  return targets[0] ?? {
    base: fielderBase,
    point: BASE_POS[fielderBase],
    priority: 0,
    reason: 'no play — fielder on base',
  };
}

// ─── Cutoff decision ─────────────────────────────────────────────

export type CutoffDecision = 'let-through' | 'cut-and-relay' | 'cut-and-hold';

/**
 * Decide what the cutoff man should do with a thrown ball:
 *   - 'let-through': ball is on target, let it pass to the base
 *   - 'cut-and-relay': catch and re-throw to a different base
 *   - 'cut-and-hold': catch and hold (runner already safe, no play)
 */
export function decideCutoff(
  cutoffFielder: FielderEntity,
  ball: BallEntity,
  runners: RunnerEntity[],
  situation: GameSituation,
): CutoffDecision {
  // If ball is a throw and has a target...
  if (ball.state.type !== 'thrown') return 'cut-and-hold';

  const throwTarget = ball.state.target;
  const distToTarget = dist2D(cutoffFielder.pos, throwTarget);

  // If the cutoff man is close to the throw target, let it through
  if (distToTarget < 20) return 'let-through';

  // Check if any runner is heading to a different base
  const activeRunners = runners.filter(r => r.state.type === 'running');
  const runnerGoingElsewhere = activeRunners.find(r => {
    if (r.state.type !== 'running') return false;
    const runnerBase = closestBaseTo(r.state.to);
    const throwBase = closestBaseTo(throwTarget);
    return runnerBase !== throwBase;
  });

  if (runnerGoingElsewhere) {
    // A runner is heading somewhere else — cut and redirect
    return 'cut-and-relay';
  }

  // Check if the lead runner is already safe
  const leadRunner = activeRunners.sort((a, b) => {
    const aIdx = baseIndex(closestBaseTo(a.state.type === 'running' ? a.state.to : a.pos));
    const bIdx = baseIndex(closestBaseTo(b.state.type === 'running' ? b.state.to : b.pos));
    return bIdx - aIdx;
  })[0];

  if (leadRunner) {
    const runnerTarget = leadRunner.state.type === 'running' ? leadRunner.state.to : leadRunner.pos;
    const runnerDist = dist2D(leadRunner.pos, runnerTarget);
    if (runnerDist < COLLIDERS.runnerOnBase * 2) {
      // Runner is basically there — no play, hold the ball
      return 'cut-and-hold';
    }
  }

  return 'let-through';
}
