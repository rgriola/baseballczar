/**
 * Runner command AI — advance/retreat/tag-up decisions.
 *
 * Controls runner movement during live ball situations:
 *   - Initial contact commands (force advance vs hold)
 *   - Per-tick re-evaluation (retreat/rundown when beaten)
 *   - Tag-up decisions after caught flies
 *   - Extra-base advance evaluation
 */
import type { BallEntity, FielderEntity, RunnerEntity, Point2D } from '../entities';
import type { Position } from '@baseballczar/sim-engine';
import { dist2D, COLLIDERS, ballWillReachFielder } from '../spatial';
import { commandRunner, BASE_POS, nextBase } from '../runnerAI';
import { closestBaseTo, type GameSituation } from './types';
import type { BaseName, OccupiedBase } from '../fieldGeometry';

// ─── Force-out detection ─────────────────────────────────────────

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

// ─── Initial runner commands on contact ──────────────────────────

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

// ─── Per-tick runner re-evaluation ───────────────────────────────

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
): { rundownEvents: import('../entities').TickEvent[] } {
  const rundownEvents: import('../entities').TickEvent[] = [];

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

    // ── FORCED-RUNNER GUARD: forced runners must advance ─────────
    // If the base behind this runner is occupied (or was just vacated
    // by the batter), the runner has no choice — they MUST advance.
    // Retreating a forced runner creates phantom turn-arounds.
    const prevBase = closestBaseTo(runner.state.from);
    const isForced = runners.some(other => {
      if (other.id === runner.id) return false;
      // Another runner is on or heading to the base we came from
      if (other.state.type === 'on-base' && other.state.base === prevBase) return true;
      if (other.state.type === 'running') {
        const otherTarget = closestBaseTo(other.state.to);
        if (otherTarget === prevBase) return true;
      }
      return false;
    });
    // Batter-runner coming from home forces R1 at first
    if (prevBase === 'first' && runners.some(r =>
      r.id !== runner.id && r.state.type === 'running' &&
      dist2D(r.state.from, BASE_POS.home) < 12
    )) {
      continue; // forced — don't retreat
    }
    if (isForced) continue; // forced — don't retreat

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

          if (progress < 0.4) {
            // Check if retreat base is also covered → RUNDOWN
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

// ─── Rundown logic ───────────────────────────────────────────────

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
): { events: import('../entities').TickEvent[] } {
  const events: import('../entities').TickEvent[] = [];
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
): { events: import('../entities').TickEvent[] } | null {
  // Currently, rundowns resolve instantly in initiateRundown().
  // Future: add multi-tick animation with back-and-forth movement.
  return null;
}

// ─── Tag-up commands ─────────────────────────────────────────────

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

// ─── Extra-base advance evaluation ──────────────────────────────

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
