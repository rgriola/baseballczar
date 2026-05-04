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
  const activeRunners = runners.filter(r =>
    r.state.type === 'running' || r.state.type === 'on-base'
  );

  if (activeRunners.length === 0) {
    // No runners — throw to pitcher/first base
    return {
      base: 'first',
      point: BASE_POS.first,
      priority: 1,
      reason: 'no runners',
    };
  }

  const targets: ThrowTarget[] = [];

  for (const runner of activeRunners) {
    // Where is this runner heading?
    let targetBase: string;
    let runnerTarget: Point2D;

    if (runner.state.type === 'running') {
      // Runner is in motion — throw ahead of them
      const closestBaseToTarget = closestBaseTo(runner.state.to);
      targetBase = closestBaseToTarget;
      runnerTarget = runner.state.to;
    } else if (runner.state.type === 'on-base') {
      // Runner on base — throw to the NEXT base (where they'd go)
      targetBase = nextBase(runner.state.base);
      runnerTarget = BASE_POS[targetBase];
    } else {
      continue;
    }

    const throwDist = dist2D(fielder.pos, runnerTarget);
    const runnerDist = dist2D(runner.pos, runnerTarget);

    // Can we beat the runner there?
    // Rough: throw arrives in throwDist / throwVelo seconds
    // Runner arrives in runnerDist / runnerSpeed seconds
    const throwTime = throwDist / fielder.throwVeloFps;
    const runnerTime = runnerDist / runner.speedFps;
    const canBeat = throwTime < runnerTime + 0.3;  // 0.3s buffer for catch/tag

    // Priority: lead runner first, then can-beat bonus, then situation
    let priority = 0;

    // Lead runner bonus (closer to scoring = higher priority)
    const basePriority: Record<string, number> = {
      home: 10,
      third: 7,
      second: 4,
      first: 2,
    };
    priority += basePriority[targetBase] ?? 1;

    // Can-beat bonus
    if (canBeat) priority += 5;

    // Two-out bonus (any out is valuable)
    if (situation.outs === 2) priority += 3;

    // Close game bonus
    if (Math.abs(situation.scoreDiff) <= 2) priority += 2;

    targets.push({
      base: targetBase,
      point: runnerTarget,
      priority,
      reason: `${targetBase} (runner ${canBeat ? 'beatable' : 'safe'})`,
    });
  }

  // Sort by priority, highest first
  targets.sort((a, b) => b.priority - a.priority);

  return targets[0] ?? {
    base: 'second',
    point: BASE_POS.second,
    priority: 0,
    reason: 'fallback',
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

/**
 * Issue commands to all runners based on the current game state.
 * Called by the tick engine when a ball is put in play.
 */
export function commandRunners(
  runners: RunnerEntity[],
  ball: BallEntity,
  situation: GameSituation,
  isCaughtFly: boolean,
): void {
  for (const runner of runners) {
    if (runner.state.type === 'scored' || runner.state.type === 'out') continue;

    if (isCaughtFly) {
      // Tag up — hold at current base, will advance after catch
      commandRunner(runner, { type: 'tag-up' });
    } else if (runner.state.type === 'on-base') {
      // Ball in play — advance!
      const target = nextBase(runner.state.base);
      commandRunner(runner, { type: 'advance', targetBase: target });
    }
  }
}

/**
 * After a fly is caught, decide which tagged-up runners should go.
 * Runners on 3B go on a sac fly (< 2 outs). Others hold.
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
    const target = BASE_POS[nextB];

    // Should this runner tag up and go?
    // Sac fly: runner on 3B goes home with < 2 outs
    if (currentBase === 'third' && situation.outs < 2) {
      const throwDist = dist2D(fielder.pos, BASE_POS.home);
      const runnerDist = dist2D(runner.pos, BASE_POS.home);
      const throwTime = throwDist / fielder.throwVeloFps;
      const runnerTime = runnerDist / runner.speedFps;

      if (runnerTime < throwTime + 0.5) {
        // Runner can beat the throw — go!
        commandRunner(runner, { type: 'advance', targetBase: 'home' });
      }
    }
    // Runner on 2B: tag up to 3B if the throw is going elsewhere
    else if (currentBase === 'second' && situation.outs < 2) {
      const throwDist = dist2D(fielder.pos, BASE_POS.third);
      if (throwDist > 200) {
        // Deep fly — tag and advance to 3B
        commandRunner(runner, { type: 'advance', targetBase: 'third' });
      }
    }
  }
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
  // Only reassign during active throws (relay situations)
  if (ball.state.type !== 'thrown') return;

  const throwTarget = ball.state.target;

  // Ensure someone is covering the throw target base
  for (const f of fielders) {
    if (f.state.type === 'covering') {
      const coverDist = dist2D(f.state.base, throwTarget);
      if (coverDist < COLLIDERS.receiveThrow) {
        // This fielder is already covering the right base
        return;
      }
    }
  }

  // No one is covering the target — find the closest idle/returning infielder
  const targetBase = closestBaseTo(throwTarget);
  const basePt = BASE_POS[targetBase];
  if (!basePt) return;

  const candidates = fielders.filter(f =>
    (f.state.type === 'idle' || f.state.type === 'returning' || f.state.type === 'backing-up')
    && ['B1', 'B2', 'SS', 'B3', 'C'].includes(f.position)
  );

  const closest = candidates.sort((a, b) =>
    dist2D(a.pos, basePt) - dist2D(b.pos, basePt)
  )[0];

  if (closest) {
    closest.state = { type: 'covering', base: basePt };
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

function closestBaseTo(pt: Point2D): string {
  let best = 'home';
  let bestDist = Infinity;
  for (const [name, pos] of Object.entries(BASE_POS)) {
    const d = dist2D(pt, pos);
    if (d < bestDist) {
      bestDist = d;
      best = name;
    }
  }
  return best;
}

function baseIndex(base: string): number {
  return ['home', 'first', 'second', 'third'].indexOf(base);
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
