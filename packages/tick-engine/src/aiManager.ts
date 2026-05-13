// Last touched by agent: 2026-05-05T06:39:42Z
/**
 * AI Manager — the central intelligence layer.
 *
 * Sits between the tick engine and entity-level AI. Issues commands
 * that entities execute via their state machines. Operates at three
 * tiers:
 *
 *   Tier 1 (Strategic): lineup, bullpen, shifts — per-game/inning
 *   Tier 2 (Tactical): pitch selection, steal/bunt — per-at-bat  ✅ Phase 3
 *   Tier 3 (Reactive): throw target, cutoff, runner signals — per-tick  ✅ Phase 2
 *
 * Phase 3 adds Tier 2 (Tactical) — pitch sequencing, defensive
 * positioning, steal/bunt signals, and intentional walk logic.
 */
import type { BallEntity, FielderEntity, RunnerEntity, Point2D } from './entities';
import type { Position } from '@baseballczar/sim-engine';
import { dist2D, COLLIDERS, ballWillReachFielder } from './spatial';
import { commandRunner, BASE_POS, nextBase } from './runnerAI';
import { throwBall } from './ballPhysics';
import { getBaseAnchor, getFielderCoverPoint, type BaseName, type OccupiedBase } from './fieldGeometry';

// ─── Game situation awareness ────────────────────────────────────

export interface GameSituation {
  outs: number;
  inning: number;
  half: 'top' | 'bottom';
  scoreDiff: number;  // positive = leading
}

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
    // No runners moving — no play to make
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
    });
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

// ─── Runner commands ─────────────────────────────────────────────

/** Base ordering for force-out calculations. */
const BASE_ORDER_FORCE = ['first', 'second', 'third', 'home'] as const;

/**
 * Determine if a runner is forced to advance.
 * A runner is forced when every base between them and home plate
 * (counting backward from their base) is occupied AND the batter
 * is running. This creates a chain: batter forces R1, R1 forces R2, etc.
 */
function isRunnerForced(
  runnerBase: string,
  allRunners: RunnerEntity[],
): boolean {
  // Get occupied bases (runners who are on-base or were on-base)
  const occupied = new Set<string>();
  for (const r of allRunners) {
    if (r.state.type === 'on-base') occupied.add(r.state.base);
  }

  // Runner on 1B is always forced (batter is coming)
  if (runnerBase === 'first') return true;

  // Runner on 2B is forced if 1B is occupied
  if (runnerBase === 'second') return occupied.has('first');

  // Runner on 3B is forced if both 1B and 2B are occupied
  if (runnerBase === 'third') return occupied.has('first') && occupied.has('second');

  return false;
}

/**
 * Issue commands to all runners based on the current game state.
 * Called by the tick engine when a ball is put in play.
 *
 * Force-out rules:
 *   - A forced runner MUST advance (can't stay at their base)
 *   - Non-forced runners advance by default on contact
 *     (they'll evaluate whether to hold later)
 */
export function commandRunners(
  runners: RunnerEntity[],
  ball: BallEntity,
  situation: GameSituation,
  isCaughtFly: boolean,
  isProbableFly = false,
): void {
  for (const runner of runners) {
    if (runner.state.type === 'scored' || runner.state.type === 'out') continue;

    if (isCaughtFly) {
      // Tag up — hold at current base, will advance after catch
      commandRunner(runner, { type: 'tag-up' });
    } else if (runner.state.type === 'on-base') {
      const forced = isRunnerForced(runner.state.base, runners);
      if (forced && !isProbableFly) {
        // Forced runners MUST advance on ground balls — no choice.
        // On fly balls the force doesn't truly exist (batter could be caught out),
        // so runners hold.
        const target = nextBase(runner.state.base);
        commandRunner(runner, { type: 'advance', targetBase: target });
      } else if (!isProbableFly) {
        // Non-forced runners on ground balls/liners: advance on contact
        // but will re-evaluate each tick via reevaluateRunners()
        const target = nextBase(runner.state.base);
        commandRunner(runner, { type: 'advance', targetBase: target });
      }
      // On probable fly balls, runners hold at their base (go halfway).
      // They'll advance via tag-up logic after the catch, or via
      // reevaluation if the ball drops.
    }
  }
}

/**
 * Per-tick runner re-evaluation. Checks ball state and determines
 * whether running runners should hold up or retreat.
 *
 * Called every tick during flight/fielding/throw phases.
 * This makes runners react to the developing play instead of
 * blindly sprinting to their target.
 */
export function reevaluateRunners(
  runners: RunnerEntity[],
  ball: BallEntity,
  fielders: FielderEntity[],
  situation: GameSituation,
): { rundownEvents: import('./entities').TickEvent[] } {
  const rundownEvents: import('./entities').TickEvent[] = [];

  for (const runner of runners) {
    // ── Handle active rundowns (runner already in rundown state) ──
    if (runner.state.type === 'rundown') {
      const result = resolveRundownTick(runner, ball, fielders);
      if (result) {
        rundownEvents.push(...result.events);
      }
      continue;
    }

    if (runner.state.type !== 'running') continue;

    const targetBase = closestBaseTo(runner.state.to);
    const targetPt = BASE_POS[targetBase];
    const distToTarget = dist2D(runner.pos, targetPt);
    const runnerTime = distToTarget / runner.speedFps;

    // ── BATTER-RUNNER GUARD: never retreat to home ───────────────
    const cameFromHome = dist2D(runner.state.from, BASE_POS.home) < 12;
    if (targetBase === 'first' && cameFromHome) continue;

    // ── If ball is HELD by a fielder near our target base → HOLD ──
    if (ball.state.type === 'held') {
      const holder = fielders.find(f =>
        f.state.type === 'has-ball' || f.state.type === 'throwing'
      );
      if (holder) {
        const holderToTarget = dist2D(holder.pos, targetPt);
        // Fielder is at (or near) the base we're running to
        if (holderToTarget < 15) {
          const totalDist = dist2D(runner.state.from, targetPt);
          const traveled = totalDist - distToTarget;
          const progress = totalDist > 0 ? traveled / totalDist : 1;

          if (progress < 0.6) {
            // Check if retreat base is also covered → RUNDOWN
            const prevBase = closestBaseTo(runner.state.from);
            const prevBasePt = BASE_POS[prevBase];
            const fielderAtRetreat = fielders.some(f =>
              f !== holder && dist2D(f.pos, prevBasePt) < 20
            );

            if (fielderAtRetreat && progress > 0.2) {
              // Caught between bases — initiate rundown
              const rd = initiateRundown(runner, prevBase, targetBase, fielders);
              rundownEvents.push(...rd.events);
            } else {
              commandRunner(runner, { type: 'retreat', targetBase: prevBase });
            }
          }
          // If > 60% committed, keep running (can't turn back)
        }
      }
    }

    // ── If a THROW is heading to our target base → evaluate ──
    if (ball.state.type === 'thrown') {
      const throwTarget = ball.state.target;
      const throwToTarget = dist2D(throwTarget, targetPt);

      if (throwToTarget < 12) {
        const throwDist = dist2D(ball.pos, throwTarget);
        const throwSpeed = Math.hypot(ball.state.vel.x, ball.state.vel.y);
        const throwTime = throwSpeed > 0 ? throwDist / throwSpeed : 0;

        if (runnerTime > throwTime + 0.3) {
          const totalDist = dist2D(runner.state.from, targetPt);
          const traveled = totalDist - distToTarget;
          const progress = totalDist > 0 ? traveled / totalDist : 1;

          if (progress < 0.5) {
            // Check if retreat base is also covered → RUNDOWN
            const prevBase = closestBaseTo(runner.state.from);
            const prevBasePt = BASE_POS[prevBase];
            const fielderAtRetreat = fielders.some(f =>
              dist2D(f.pos, prevBasePt) < 25
            );

            if (fielderAtRetreat && progress > 0.15) {
              const rd = initiateRundown(runner, prevBase, targetBase, fielders);
              rundownEvents.push(...rd.events);
            } else {
              commandRunner(runner, { type: 'retreat', targetBase: prevBase });
            }
          }
        }
      }
    }
  }

  return { rundownEvents };
}

/**
 * Initiate a rundown sequence. The runner gets caught between two bases
 * and must juke/dodge fielders to reach safety.
 *
 * The outcome is resolved probabilistically based on:
 *   - PI (play intelligence): higher PI → better reads, juke moves
 *   - Speed: faster runners can outrun throws
 *   - Fielder throwing accuracy
 *
 * MLB rundowns result in an out ~90% of the time, with elite
 * baserunners occasionally escaping.
 */
function initiateRundown(
  runner: RunnerEntity,
  fromBase: string,
  toBase: string,
  fielders: FielderEntity[],
): { events: import('./entities').TickEvent[] } {
  const events: import('./entities').TickEvent[] = [];
  const pi = runner.playIntelligence ?? 5;
  const speed = runner.speedFps;

  // Escape probability:
  // Base: 10% escape rate
  // PI bonus: +2% per PI point above 5 (PI 10 = +10%)
  // Speed bonus: +1% per fps above 25 (fast runners ≈ 28-30 fps)
  // Max escape: ~25% for elite PI+speed combo
  const baseEscape = 0.10;
  const piBonus = Math.max(0, (pi - 5)) * 0.02;
  const speedBonus = Math.max(0, (speed - 25)) * 0.01;
  const escapeProb = Math.min(0.25, baseEscape + piBonus + speedBonus);

  // Random resolution (use simple Math.random for now)
  const roll = Math.random();
  const escaped = roll < escapeProb;

  // Generate rundown throw sequence (2-4 throws for drama)
  const numThrows = 2 + Math.floor(Math.random() * 3);  // 2-4 throws

  events.push({
    type: 'rundown-start',
    runnerId: runner.id,
    between: [fromBase, toBase],
  });

  // Generate throw events
  for (let i = 0; i < numThrows; i++) {
    const throwFrom = i % 2 === 0 ? toBase : fromBase;
    const throwTo = i % 2 === 0 ? fromBase : toBase;
    events.push({ type: 'rundown-throw', from: throwFrom, to: throwTo });
  }

  if (escaped) {
    // Runner escapes — juke to the closer base
    // Determine which base the runner ends up at
    const fromPt = BASE_POS[fromBase as keyof typeof BASE_POS];
    const toPt = BASE_POS[toBase as keyof typeof BASE_POS];
    const distToFrom = fromPt ? dist2D(runner.pos, fromPt) : Infinity;
    const distToTo = toPt ? dist2D(runner.pos, toPt) : Infinity;
    const safeBase = distToFrom < distToTo ? fromBase : toBase;
    const safePt = BASE_POS[safeBase as keyof typeof BASE_POS];

    if (safePt) {
      runner.state = { type: 'running', from: runner.pos, to: safePt };
    }

    events.push({
      type: 'rundown-end',
      runnerId: runner.id,
      result: 'safe',
      at: safeBase,
    });
  } else {
    // Runner is out
    runner.state = { type: 'out' };
    events.push({
      type: 'rundown-end',
      runnerId: runner.id,
      result: 'out',
      at: `between ${fromBase} and ${toBase}`,
    });
  }

  return { events };
}

/**
 * Process a runner already in rundown state — move them toward
 * their juke target and resolve the rundown outcome.
 * Currently resolves instantly in initiateRundown(); this is a
 * placeholder for future tick-by-tick animated rundowns.
 */
function resolveRundownTick(
  _runner: RunnerEntity,
  _ball: BallEntity,
  _fielders: FielderEntity[],
): { events: import('./entities').TickEvent[] } | null {
  // Currently, rundowns resolve instantly in initiateRundown().
  // Future: add multi-tick animation with back-and-forth movement.
  return null;
}

/**
 * After a fly is caught, decide which tagged-up runners should go.
 *
 * Tag-up decisions are skill-based:
 *   - Speed: can the runner physically beat the throw?
 *   - PI: does the runner read the play correctly?
 *     High PI → better read on ball depth + fielder arm
 *     Low PI → conservative, only tags on obvious opportunities
 *
 * Runners on 3B: tag up home (sac fly) with < 2 outs
 * Runners on 2B: tag up to 3B on deep flies / weak arms
 * Runners on 1B: rarely tag (too risky unless very deep)
 */
export function commandTagUpRunners(
  runners: RunnerEntity[],
  fielder: FielderEntity,
  situation: GameSituation,
): void {
  for (const runner of runners) {
    if (runner.state.type !== 'on-base') continue;

    const currentBase = runner.state.base;
    const nextB = nextBase(currentBase);
    const targetPt = BASE_POS[nextB];
    const pi = runner.playIntelligence ?? 5;

    if (currentBase === 'third' && situation.outs < 2) {
      // Sac fly: runner on 3B tags home
      const throwDist = dist2D(fielder.pos, BASE_POS.home);
      const runnerDist = dist2D(runner.pos, BASE_POS.home);
      const throwTime = throwDist / fielder.throwVeloFps;
      const runnerTime = runnerDist / runner.speedFps;

      // PI gives margin: high PI runners go on closer plays
      const piMargin = (pi - 5) * 0.08;  // PI 10 = +0.4s, PI 1 = -0.32s
      if (runnerTime < throwTime + 0.3 + piMargin) {
        commandRunner(runner, { type: 'advance', targetBase: 'home' });
      }
    } else if (currentBase === 'second' && situation.outs < 2) {
      // Tag to 3B: evaluate throw time vs runner time
      const throwDist = dist2D(fielder.pos, BASE_POS.third);
      const runnerDist = dist2D(runner.pos, BASE_POS.third);
      const throwTime = throwDist / fielder.throwVeloFps;
      const runnerTime = runnerDist / runner.speedFps;

      // Easier tag than home — OF usually throws home, not to 3B
      const piMargin = (pi - 5) * 0.06;
      // If the throw is going home (deep fly), the runner can tag easily
      const throwGoingHome = throwDist > dist2D(fielder.pos, BASE_POS.home) + 20;
      const margin = throwGoingHome ? 1.0 : 0.3;

      if (runnerTime < throwTime + margin + piMargin) {
        commandRunner(runner, { type: 'advance', targetBase: 'third' });
      }
    }
    // Runners on 1B: too risky to tag to 2B in most situations
    // Could add for very deep flies with high-PI/fast runners later
  }
}

/**
 * Evaluate whether a runner who just arrived at a base should
 * continue to the next base. Called when a runner reaches a base
 * and the ball is still in play.
 *
 * This is the core runner decision engine. Evaluates real-time
 * physics (ball position, fielder distance, throw trajectory)
 * against runner speed and Play Intelligence (PI).
 *
 * Returns true if the runner should advance to the next base.
 */
export function evaluateExtraBaseAdvance(
  runner: RunnerEntity,
  ball: BallEntity,
  fielders: FielderEntity[],
  situation: GameSituation,
): boolean {
  if (runner.state.type !== 'on-base') return false;

  const currentBase = runner.state.base;
  const nextB = nextBase(currentBase);

  // Already at 3B heading home is handled by normal base advancement
  // Don't try to score from 1B directly (needs 1B→2B→3B→home chain)
  if (nextB === 'home' && currentBase === 'first') {
    return false;
  }

  const nextBasePt = BASE_POS[nextB];
  const runnerDist = dist2D(runner.pos, nextBasePt);
  const runnerTime = runnerDist / runner.speedFps;

  const pi = runner.playIntelligence ?? 5;
  // PI margin: high PI = earlier commit, more aggressive
  // PI 1: -0.6s (very conservative)
  // PI 5: 0.0s  (neutral)
  // PI 10: +0.75s (commits early on close plays)
  const piMargin = (pi - 5) * 0.15;

  // ── Ball is being THROWN ──────────────────────────────────────
  if (ball.state.type === 'thrown') {
    const throwTarget = ball.state.target;
    const throwToNextBase = dist2D(throwTarget, nextBasePt);

    if (throwToNextBase < 15) {
      // Throw is coming to our target base!
      // Can we beat it?
      const throwDist = dist2D(ball.pos, throwTarget);
      const throwSpeed = Math.hypot(ball.state.vel.x, ball.state.vel.y);
      const throwArrival = throwSpeed > 0 ? throwDist / throwSpeed : 0;
      const catchTransfer = 0.4;  // catcher receives + tag
      const totalDefense = throwArrival + catchTransfer;

      return runnerTime < totalDefense + piMargin;
    }

    // Throw is going ELSEWHERE — advance freely if close enough
    // High PI: reads that the throw is going to a different base
    if (pi >= 4 && runnerTime < 3.0) return true;
    if (pi >= 7 && runnerTime < 4.0) return true;
    return false;
  }

  // ── Ball is HELD by a fielder ─────────────────────────────────
  if (ball.state.type === 'held') {
    const holder = fielders.find(f =>
      f.state.type === 'has-ball' || f.state.type === 'throwing'
    );
    if (!holder) return false;

    const holderToNextBase = dist2D(holder.pos, nextBasePt);

    // If the fielder is NEAR our target base (<20 ft) — don't go
    if (holderToNextBase < 20) return false;

    // Fielder has the ball but is far away (e.g., CF at 320 ft
    // holding the ball while runner rounds 1B). Estimate total
    // defensive time: wind-up + throw to next base.
    const windUp = 0.4;
    const throwTime = holderToNextBase / (holder.throwVeloFps || 100);
    const catchTransfer = 0.4;
    const totalDefense = windUp + throwTime + catchTransfer;

    // Aggressive: if runner can beat the throw, go
    if (runnerTime < totalDefense + piMargin) return true;

    // High-PI runners also go if the fielder is very deep (>150 ft from base)
    // even if it's close — they trust their read
    if (pi >= 8 && holderToNextBase > 150 && runnerTime < totalDefense + 0.5) {
      return true;
    }

    return false;
  }

  // ── Ball is ROLLING or IDLE (still on the ground) ─────────────
  if (ball.state.type === 'rolling' || ball.state.type === 'idle') {
    // Find the closest fielder to the ball
    let closestDist = Infinity;
    let closestFielder: FielderEntity | undefined;
    for (const f of fielders) {
      const d = dist2D(f.pos, ball.pos);
      if (d < closestDist) {
        closestDist = d;
        closestFielder = f;
      }
    }

    if (!closestFielder) return false;

    // Estimate: fielder reaches ball + picks up + throws to next base
    const fielderToBall = closestDist / closestFielder.speedFps;
    const pickupTransfer = 0.5;  // pick up + turn + throw
    const throwDist = dist2D(ball.pos, nextBasePt);
    const throwTime = throwDist / (closestFielder.throwVeloFps || 100);
    const totalDefenseTime = fielderToBall + pickupTransfer + throwTime;

    // Runner needs to beat the total defensive time
    if (runnerTime < totalDefenseTime + piMargin) {
      return true;
    }

    // Ball is far from any fielder — very aggressive runners go
    if (closestDist > 50 && pi >= 6 && runnerTime < totalDefenseTime + 1.0) {
      return true;
    }
  }

  // ── Ball is IN FLIGHT (not yet caught or landed) ──────────────
  if (ball.state.type === 'in-flight') {
    // Ball is in the air — runner should be advancing on contact
    // Extra-base advance means going 1st→3rd or 2nd→home on a hit
    if (pi >= 3 && runnerTime < 3.5 + piMargin) {
      return true;
    }
  }

  return false;
}

// ─── Fielder role reassignment ───────────────────────────────────

/**
 * Dynamically reassign fielder roles based on ball/runner state.
 * Called every tick during live ball situations. This is the
 * "reactive" tier — adjusting coverage as the play develops.
 */
export function reassignFielderRoles(
  fielders: FielderEntity[],
  ball: BallEntity,
  runners: RunnerEntity[],
  situation: GameSituation,
): void {
  // During throws, ensure someone covers the throw target
  if (ball.state.type === 'thrown') {
    ensureThrowTargetCovered(fielders, ball.state.target);
    return;
  }

  // During rolling/idle ball, assign situational coverage to non-busy fielders
  if (ball.state.type === 'rolling' || ball.state.type === 'idle' || ball.state.type === 'in-flight') {
    applySituationalCoverage(fielders, runners, situation, ball);
  }
}

// ─── Situational coverage logic ─────────────────────────────────

/**
 * Decide where a non-primary fielder should go based on the game
 * situation. Considers runner positions, outs, and ball location.
 */
function applySituationalCoverage(
  fielders: FielderEntity[],
  runners: RunnerEntity[],
  situation: GameSituation,
  ball: BallEntity,
): void {
  // Only assign idle/returning/backing-up fielders — don't override
  // anyone actively tracking, chasing, holding, throwing, or covering.
  const occupiedBases = new Set<string>();
  for (const r of runners) {
    if (r.state.type === 'on-base') occupiedBases.add(r.state.base);
    if (r.state.type === 'running') {
      const targetBase = closestBaseTo(r.state.to);
      occupiedBases.add(targetBase);
    }
  }

  // Always need home covered
  occupiedBases.add('home');

  // Build a list of bases that need coverage based on ACTUAL runners.
  // Only cover bases where a runner could realistically advance.
  const basesToCover: BaseName[] = [];
  // First base always needs coverage (batter-runner heading there)
  basesToCover.push('first');
  // Second only if runner on first could advance there
  if (occupiedBases.has('first')) basesToCover.push('second');
  // Third only if runner on second could advance there
  if (occupiedBases.has('second')) basesToCover.push('third');
  basesToCover.push('home');  // catcher always covers home

  // Track which bases already have a fielder covering them
  const coveredBases = new Set<string>();
  for (const f of fielders) {
    if (f.state.type === 'covering') {
      const base = closestBaseTo(f.state.base);
      coveredBases.add(base);
    }
  }

  // Natural position-to-base affinity
  const positionBaseAffinity: Partial<Record<Position, BaseName>> = {
    C: 'home',
    B1: 'first',
    B2: 'second',
    SS: 'second',
    B3: 'third',
    P: 'home',  // pitcher backs up home or covers first
  };

  for (const f of fielders) {
    // Only reassign fielders that are not busy
    if (f.state.type !== 'idle' && f.state.type !== 'returning' && f.state.type !== 'backing-up') {
      continue;
    }

    // Skip outfielders — they should be backing up, not covering bases
    if (['LF', 'CF', 'RF'].includes(f.position)) continue;

    const naturalBase = positionBaseAffinity[f.position];
    if (!naturalBase) continue;

    // If the base we'd naturally cover needs it and isn't covered yet
    if (basesToCover.includes(naturalBase) && !coveredBases.has(naturalBase)) {
      const coverPoint = naturalBase === 'home'
        ? getBaseAnchor('home')
        : getFielderCoverPoint(naturalBase as OccupiedBase, f.position);
      f.state = { type: 'covering', base: coverPoint };
      coveredBases.add(naturalBase);
    }
  }

  // Special: pitcher covers first if B1 is the primary fielder
  const b1 = fielders.find(f => f.position === 'B1');
  const pitcher = fielders.find(f => f.position === 'P');
  if (b1 && pitcher &&
      (b1.state.type === 'chasing' || b1.state.type === 'tracking' || b1.state.type === 'has-ball') &&
      (pitcher.state.type === 'idle' || pitcher.state.type === 'returning' || pitcher.state.type === 'backing-up') &&
      !coveredBases.has('first')) {
    pitcher.state = { type: 'covering', base: getFielderCoverPoint('first', 'P') };
    coveredBases.add('first');
  }
}

// ─── Throw target coverage ──────────────────────────────────────

function ensureThrowTargetCovered(
  fielders: FielderEntity[],
  throwTarget: Point2D,
): void {
  // Check if someone is already covering the throw target
  for (const f of fielders) {
    if (f.state.type === 'covering') {
      const coverDist = dist2D(f.state.base, throwTarget);
      if (coverDist < COLLIDERS.receiveThrow) {
        return;  // Already covered
      }
    }
  }

  // No one is covering the target — find the closest idle/returning infielder
  const targetBase = closestBaseTo(throwTarget);
  const basePt = BASE_POS[targetBase];
  if (!basePt) return;

  const candidates = fielders.filter(f =>
    (f.state.type === 'idle' || f.state.type === 'returning' || f.state.type === 'backing-up')
    && ['B1', 'B2', 'SS', 'B3', 'C', 'P'].includes(f.position)
    && (targetBase === 'home' || f.position !== 'C')
  );

  const preferredByBase: Record<BaseName, Position[]> = {
    home: ['C', 'P', 'B3'],
    first: ['B1', 'P', 'B2'],
    second: ['B2', 'SS', 'B1'],
    third: ['B3', 'SS', 'P'],
  };
  const preferred = preferredByBase[targetBase] ?? [];

  const closest = candidates.sort((a, b) => {
    const aPref = preferred.includes(a.position) ? 0 : 1;
    const bPref = preferred.includes(b.position) ? 0 : 1;
    if (aPref !== bPref) return aPref - bPref;
    return dist2D(a.pos, basePt) - dist2D(b.pos, basePt);
  })[0];

  if (closest) {
    const coverPoint = targetBase === 'home'
      ? getBaseAnchor('home')
      : getFielderCoverPoint(targetBase as OccupiedBase, closest.position);
    closest.state = { type: 'covering', base: coverPoint };
  }
}

// ─── Predictive tracking (fielder AI enhancement) ────────────────

/**
 * Update a tracking fielder's target using ball trajectory prediction.
 * Instead of running to a static point, the fielder continuously
 * adjusts toward where the ball WILL BE.
 */
export function updatePredictedTracking(
  fielder: FielderEntity,
  ball: BallEntity,
): void {
  if (fielder.state.type !== 'tracking') return;
  if (ball.state.type !== 'in-flight') return;

  const vel = ball.state.vel;
  const vz = vel.z;
  const z = ball.pos.z;
  const g = 32.174;

  // Predict landing point using current velocity
  const disc = vz * vz + 2 * g * z;
  if (disc < 0) return;
  const tLand = (vz + Math.sqrt(disc)) / g;

  // Horizontal position at landing (with simple drag estimate)
  const dragFactor = 0.85;  // rough average drag over remaining flight
  const predictedLanding: Point2D = {
    x: ball.pos.x + vel.x * tLand * dragFactor,
    y: ball.pos.y + vel.y * tLand * dragFactor,
  };

  // Update the fielder's tracking target
  fielder.state.target = predictedLanding;
}

// ─── Helpers ─────────────────────────────────────────────────────

function closestBaseTo(pt: Point2D): BaseName {
  let best: BaseName = 'home';
  let bestDist = Infinity;
  for (const [name, pos] of Object.entries(BASE_POS)) {
    const d = dist2D(pt, pos);
    if (d < bestDist) {
      bestDist = d;
      best = name as BaseName;
    }
  }
  return best;
}

function baseIndex(base: string): number {
  return ['home', 'first', 'second', 'third'].indexOf(base);
}

// ═══════════════════════════════════════════════════════════════════
// DEFENSIVE ALIGNMENT — Pre-contact positioning
// ═══════════════════════════════════════════════════════════════════

export type BatterHand = 'L' | 'R';

interface AlignmentResult {
  positions: Partial<Record<Position, Point2D>>;
  label: string;  // for PBP/debugging: "standard", "infield-in", "no-doubles", etc.
}

/**
 * Compute pre-pitch defensive alignment based on game situation.
 * Returns adjusted home positions for fielders that should shift.
 *
 * @param situation - outs, inning, score
 * @param runners - current runners on base
 * @param batterHand - 'L' or 'R' for generic pull tendency
 */
export function getDefensiveAlignment(
  situation: GameSituation,
  runners: RunnerEntity[],
  batterHand: BatterHand = 'R',
): AlignmentResult {
  const occupiedBases = new Set<string>();
  for (const r of runners) {
    if (r.state.type === 'on-base') occupiedBases.add(r.state.base);
  }

  const hasRunnerOnThird = occupiedBases.has('third');
  const hasRunnerOnSecond = occupiedBases.has('second');
  const hasRunnerOnFirst = occupiedBases.has('first');
  const isLate = situation.inning >= 7;
  const isCloseGame = Math.abs(situation.scoreDiff) <= 2;

  // ── Infield-in: runner on 3B, fewer than 2 outs ──────────────
  // Bring infield in 20 ft to cut off the run at the plate.
  if (hasRunnerOnThird && situation.outs < 2) {
    const inDelta = 20;
    return {
      positions: {
        B1: { x: 50,   y: 85 - inDelta },
        B2: { x: 35,   y: 130 - inDelta },
        SS: { x: -35,  y: 130 - inDelta },
        B3: { x: -50,  y: 85 - inDelta },
      },
      label: 'infield-in',
    };
  }

  // ── Bunt defense: runner on 1B or 2B, 0 outs ─────────────────
  // P/1B/3B creep forward to field the bunt.
  if ((hasRunnerOnFirst || hasRunnerOnSecond) && situation.outs === 0) {
    return {
      positions: {
        P:  { x: 0,    y: 50 },   // pitcher creeps toward plate
        B1: { x: 40,   y: 65 },   // 1B plays in
        B3: { x: -40,  y: 65 },   // 3B plays in
      },
      label: 'bunt-defense',
    };
  }

  // ── No-doubles: late in close game, OF plays deep ─────────────
  // Outfielders push back ~25 ft to prevent extra bases.
  if (isLate && isCloseGame && !hasRunnerOnThird) {
    const deepDelta = 25;
    return {
      positions: {
        LF: { x: -136, y: 227 + deepDelta },
        CF: { x:    0, y: 295 + deepDelta },
        RF: { x:  136, y: 227 + deepDelta },
      },
      label: 'no-doubles',
    };
  }

  // ── Pull shift: generic L/R batter tendency ───────────────────
  // Shift the infield and outfield toward the pull side.
  // L batter pulls to right → shift right. R batter pulls left → shift left.
  const pullShift = batterHand === 'L' ? 12 : -12;  // ft of lateral shift
  const ofPullShift = batterHand === 'L' ? 20 : -20;

  return {
    positions: {
      B2: { x: 35 + pullShift,   y: 130 },
      SS: { x: -35 + pullShift,  y: 130 },
      LF: { x: -136 + ofPullShift, y: 227 },
      RF: { x:  136 + ofPullShift, y: 227 },
    },
    label: 'pull-shift',
  };
}

// ═══════════════════════════════════════════════════════════════════
// TIER 2 — TACTICAL (per-at-bat decisions)
// ═══════════════════════════════════════════════════════════════════

// ─── Pitch selection / sequencing ────────────────────────────────

export interface PitchCall {
  zone: 'in' | 'edge' | 'off';
  intent: 'strike' | 'chase' | 'waste' | 'setup';
  speed: 'hard' | 'off-speed' | 'breaking';
  /** PBP-friendly description of why this pitch was selected. */
  reasoning: string;
}

/**
 * Tactical pitch selection. The catcher (managed by the AI Manager)
 * calls pitches based on:
 *   - Count (ahead/behind/even)
 *   - Batter tendencies (power, eye, discipline)
 *   - Pitcher repertoire (pitchIntel)
 *   - Game situation (runners, outs, score)
 */
export function selectPitch(
  balls: number,
  strikes: number,
  batterSkills: { power: number; eye: number; ag: number; dhr: number },
  pitcherIntel: number,
  situation: GameSituation,
  pitchSequence: PitchCall[],  // what we've thrown so far this AB
): PitchCall {
  const count = `${balls}-${strikes}`;
  const ahead = strikes > balls;
  const behind = balls > strikes;
  const twoStrikes = strikes >= 2;
  const threeGalls = balls >= 3;
  const isPowerHitter = batterSkills.power >= 7;
  const hasGoodEye = batterSkills.eye >= 7;
  const isDisciplined = batterSkills.ag >= 7;
  const isFlyBallHitter = batterSkills.dhr >= 7;
  const lastPitch = pitchSequence[pitchSequence.length - 1];

  // Sequencing: vary speed from the last pitch
  const shouldChangeSpeed = lastPitch && lastPitch.speed === 'hard';

  // 3-0, 3-1: must throw a strike, give them something hittable
  if (threeGalls && strikes < 2) {
    return {
      zone: 'in',
      intent: 'strike',
      speed: 'hard',
      reasoning: `${count} count — needs to throw a strike`,
    };
  }

  // 0-2: classic putaway count — waste one or go for the chase
  if (strikes >= 2 && balls <= 1) {
    if (isDisciplined) {
      // Disciplined batter — need to paint the corner
      return {
        zone: 'edge',
        intent: 'chase',
        speed: shouldChangeSpeed ? 'breaking' : 'hard',
        reasoning: `${count} putaway — disciplined hitter, painting corner`,
      };
    }
    return {
      zone: 'off',
      intent: 'chase',
      speed: pitcherIntel >= 7 ? 'breaking' : 'off-speed',
      reasoning: `${count} putaway — expanding off the plate`,
    };
  }

  // Ahead in count — work the edges
  if (ahead) {
    if (isPowerHitter) {
      return {
        zone: 'off',
        intent: 'chase',
        speed: 'breaking',
        reasoning: `Ahead ${count} — breaking ball to power hitter`,
      };
    }
    return {
      zone: 'edge',
      intent: 'chase',
      speed: shouldChangeSpeed ? 'off-speed' : 'hard',
      reasoning: `Ahead ${count} — working the edge`,
    };
  }

  // Behind in count — need strikes
  if (behind) {
    if (hasGoodEye) {
      return {
        zone: 'in',
        intent: 'strike',
        speed: 'hard',
        reasoning: `Behind ${count} — fastball in the zone (good eye, can't nibble)`,
      };
    }
    return {
      zone: 'edge',
      intent: 'strike',
      speed: 'hard',
      reasoning: `Behind ${count} — competitive pitch on the edge`,
    };
  }

  // Even count or first pitch — setup pitch
  if (pitchSequence.length === 0) {
    // First pitch: high-intel pitchers start with off-speed to get ahead
    if (pitcherIntel >= 7) {
      return {
        zone: 'edge',
        intent: 'strike',
        speed: 'off-speed',
        reasoning: `First pitch — smart pitcher starting with off-speed`,
      };
    }
    return {
      zone: 'in',
      intent: 'strike',
      speed: 'hard',
      reasoning: `First pitch fastball`,
    };
  }

  // Default: work the edge with speed variation
  return {
    zone: 'edge',
    intent: 'setup',
    speed: shouldChangeSpeed ? 'off-speed' : 'hard',
    reasoning: `${count} — working the sequence`,
  };
}

// ─── Defensive positioning / shifts ──────────────────────────────

export interface DefensiveAlignment {
  /** Adjusted positions for infielders (key = position, value = feet offset from default). */
  shifts: Map<string, Point2D>;
  /** Description for PBP. */
  description: string;
}

/**
 * Compute defensive positioning adjustments based on the batter.
 * Returns position offsets that the tick engine applies to fielder
 * home positions before the at-bat.
 *
 * Shift types:
 *   - Pull shift: against power pull hitters (move IF/OF to pull side)
 *   - No-doubles: with runner on 2B, OF plays deeper
 *   - IF-in: runner on 3B, less than 2 outs, infield draws in
 */
export function computeDefensiveAlignment(
  batterHand: 'L' | 'R' | 'S',
  batterSkills: { power: number; dhr: number; speed: number },
  situation: GameSituation,
  runnersOnBase: string[],  // ['first', 'second', 'third']
): DefensiveAlignment {
  const shifts = new Map<string, Point2D>();
  const descriptions: string[] = [];

  // Pull shift: power hitter with pull tendency
  if (batterSkills.power >= 7) {
    const pullSide = batterHand === 'L' ? 1 : -1;  // L pulls to right, R pulls to left

    // Shift SS and B2 toward pull side
    shifts.set('SS', { x: pullSide * 20, y: 0 });
    shifts.set('B2', { x: pullSide * 15, y: 0 });
    // Shift B3 to SS position if extreme pull hitter
    if (batterSkills.power >= 9) {
      shifts.set('B3', { x: pullSide * 30, y: 10 });
      descriptions.push(`Full pull shift (${batterHand}H power)`);
    } else {
      descriptions.push(`Partial shift (${batterHand}H power)`);
    }
  }

  // No-doubles defense: runner on 2B, play OF deeper
  if (runnersOnBase.includes('second')) {
    shifts.set('LF', { x: 0, y: 15 });
    shifts.set('CF', { x: 0, y: 15 });
    shifts.set('RF', { x: 0, y: 15 });
    descriptions.push('No-doubles depth');
  }

  // Infield in: runner on 3B, less than 2 outs
  if (runnersOnBase.includes('third') && situation.outs < 2) {
    const inDraw = -25;  // 25 ft closer to home
    shifts.set('B1', { x: 0, y: inDraw });
    shifts.set('B2', {
      x: (shifts.get('B2')?.x ?? 0),
      y: inDraw,
    });
    shifts.set('SS', {
      x: (shifts.get('SS')?.x ?? 0),
      y: inDraw,
    });
    shifts.set('B3', {
      x: (shifts.get('B3')?.x ?? 0),
      y: inDraw,
    });
    descriptions.push('Infield in (runner on 3B)');
  }

  return {
    shifts,
    description: descriptions.length > 0
      ? descriptions.join(' + ')
      : 'Standard alignment',
  };
}

// ─── Steal / bunt signals ────────────────────────────────────────

export interface ManagerSignal {
  type: 'steal' | 'bunt' | 'hit-and-run' | 'take' | 'swing-away';
  runner?: number;    // runner ID for steal
  reasoning: string;
}

/**
 * Evaluate whether to signal a steal, bunt, or hit-and-run.
 * Called before each pitch by the offensive manager.
 */
export function evaluateSignal(
  runners: RunnerEntity[],
  batterSkills: { power: number; avg: number; speed: number },
  situation: GameSituation,
  balls: number,
  strikes: number,
): ManagerSignal {
  const runnersOnBase = runners.filter(r => r.state.type === 'on-base');

  // Steal: fast runner on 1B, less than 2 outs, pitcher not holding
  const stealCandidate = runnersOnBase.find(r =>
    r.state.type === 'on-base' &&
    r.state.base === 'first' &&
    r.speedFps >= 28  // ~8.5+ speed skill
  );

  if (stealCandidate && situation.outs < 2 && balls >= 1) {
    return {
      type: 'steal',
      runner: stealCandidate.id,
      reasoning: 'Fast runner, favorable count — steal 2B',
    };
  }

  // Bunt: fast batter, close game, runner on 1B, less than 2 outs
  if (
    batterSkills.speed >= 7 &&
    batterSkills.power < 5 &&
    runnersOnBase.some(r => r.state.type === 'on-base' && r.state.base === 'first') &&
    situation.outs === 0 &&
    Math.abs(situation.scoreDiff) <= 1
  ) {
    return {
      type: 'bunt',
      reasoning: 'Sac bunt — advancing runner to scoring position',
    };
  }

  // Hit-and-run: runner on 1B, good contact hitter, 1-1 or 2-1 count
  if (
    runnersOnBase.some(r => r.state.type === 'on-base' && r.state.base === 'first') &&
    batterSkills.avg >= 7 &&
    balls >= 1 &&
    strikes <= 1
  ) {
    return {
      type: 'hit-and-run',
      reasoning: 'Hit and run — contact hitter, good count',
    };
  }

  // Take: 3-0 count (don't swing)
  if (balls === 3 && strikes === 0) {
    return {
      type: 'take',
      reasoning: '3-0 take sign',
    };
  }

  return {
    type: 'swing-away',
    reasoning: 'No special signal — swing away',
  };
}

// ─── Intentional walk decision ───────────────────────────────────

/**
 * Should we intentionally walk this batter?
 *   - First base must be open
 *   - Dangerous hitter (high power + avg)
 *   - Less dangerous batter on deck
 *   - Game situation warrants it (tight game, runner in scoring position)
 */
export function shouldIntentionallyWalk(
  batterSkills: { power: number; avg: number },
  onDeckSkills: { power: number; avg: number } | null,
  runnersOnBase: string[],
  situation: GameSituation,
): { walk: boolean; reasoning: string } {
  // Can't walk if first base is occupied
  if (runnersOnBase.includes('first')) {
    return { walk: false, reasoning: 'First base occupied' };
  }

  const batterThreat = batterSkills.power * 0.6 + batterSkills.avg * 0.4;
  const onDeckThreat = onDeckSkills
    ? onDeckSkills.power * 0.6 + onDeckSkills.avg * 0.4
    : 5;

  // Walk if: big threat, on-deck is much weaker, and game is close
  if (
    batterThreat >= 7.5 &&
    onDeckThreat < batterThreat - 2 &&
    Math.abs(situation.scoreDiff) <= 2 &&
    situation.outs < 2
  ) {
    return {
      walk: true,
      reasoning: `IBB — dangerous hitter (${batterThreat.toFixed(1)} threat), weaker on-deck`,
    };
  }

  return { walk: false, reasoning: 'No IBB warranted' };
}
