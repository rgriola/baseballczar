/**
 * Pre-pitch actions — baserunning sub-system.
 *
 * Covers everything that happens BETWEEN pitches:
 *   - Runner lead distances
 *   - Steal attempt resolution
 *   - Pickoff attempts
 *   - Wild pitch / passed ball
 *   - Manager signals (steal / bunt / hit-and-run)
 *   - Intentional walk decision
 */
import type { RunnerEntity } from '../entities';
import { CONFIG, sprintFtPerSec, throwVelocityMph } from '@baseballczar/sim-engine';
import { type GameSituation } from './types';

// ─── Runner lead distance ────────────────────────────────────────

/**
 * Compute how far off the bag a runner takes their lead (ft).
 * Base-specific with speed and PI bonuses.
 * At 3B, the lead angles into foul territory — callers handle the offset.
 */
export function leadDistanceFt(
  base: 'first' | 'second' | 'third',
  speedSkill: number,
  piSkill: number,
): number {
  const cfg = CONFIG.stealing.lead;
  const baseLead = base === 'first' ? cfg.firstBaseFt
    : base === 'second' ? cfg.secondBaseFt
    : cfg.thirdBaseFt;
  const speedKey = base === 'first' ? 'first' : base === 'second' ? 'second' : 'third';
  const speedBonus = Math.max(0, speedSkill - 5) * cfg.speedBonusPerPt[speedKey];
  const piBonus = Math.max(0, piSkill - 5) * cfg.piBonusPerPt;
  return Math.max(cfg.minLeadFt, Math.min(cfg.maxLeadFt, baseLead + speedBonus + piBonus));
}

// ─── Steal attempt resolution ────────────────────────────────────

export interface StealAttemptResult {
  success: boolean;
  runnerId: number;
  runnerName?: string;
  fromBase: 'first' | 'second';
  toBase: 'second' | 'third';
  marginSec: number;        // + = safe by this much, - = out by this much
  successProb: number;       // for debugging / logging
}

/**
 * Resolve a steal attempt using physics timing.
 *
 * The runner breaks when the pitcher commits to throwing home (stretch delivery).
 * Runner timing: jump + sprint (90ft - leadDist) at full speed.
 * Defense timing: stretch delivery + catcher pop time + throw flight.
 * LHP facing 1B adds delay to runner's jump; RHP back to 2B gives slight edge.
 */
export function resolveStealAttempt(
  runner: { id: number; speedSkill: number; piSkill: number; name?: string },
  fromBase: 'first' | 'second',
  toBase: 'second' | 'third',
  pitcherHand: 'L' | 'R',
  catcherThrowingSkill: number,
): StealAttemptResult {
  const cfg = CONFIG.stealing;
  const leadFt = leadDistanceFt(fromBase, runner.speedSkill, runner.piSkill);
  const distToBaseFt = 90 - leadFt;
  const runnerSpeedFps = sprintFtPerSec(runner.speedSkill);

  // Runner timing: jump + sprint (with acceleration phase)
  const jumpSec = cfg.jumpBaseSec + Math.max(0, (5 - runner.piSkill)) * cfg.jumpPILeverageSec;
  const accel = CONFIG.runner.accelTimeSec;
  const accelDist = 0.5 * runnerSpeedFps * accel;
  const runnerTimeSec = accelDist >= distToBaseFt
    ? jumpSec + Math.sqrt(2 * distToBaseFt / runnerSpeedFps * accel)
    : jumpSec + accel + (distToBaseFt - accelDist) / runnerSpeedFps;

  // Pitcher handedness: LHP faces 1B runner (harder to get jump),
  // RHP has back to 2B runner (easier to get jump)
  let handPenaltySec = 0;
  if (fromBase === 'first' && pitcherHand === 'L') {
    handPenaltySec = cfg.lhpPenaltyAt1BSec;
  } else if (fromBase === 'second' && pitcherHand === 'R') {
    handPenaltySec = -cfg.rhpPenaltyAt2BSec;
  }
  const adjustedRunnerTime = runnerTimeSec + handPenaltySec;

  // Defense timing: stretch delivery + catcher pop-time + throw flight
  const catcherTH = Math.max(1, Math.min(10, catcherThrowingSkill));
  const catcherPopTimeSec = cfg.catcherPopTimeBaseSec + (10 - catcherTH) * cfg.catcherPopTimePerSkillPt;
  const throwDistFt = toBase === 'second' ? cfg.homeToSecondFt : cfg.homeToThirdFt;
  const catcherThrowVeloFps = throwVelocityMph('C', catcherTH) * CONFIG.flight.mphToFps;
  const throwFlightSec = throwDistFt / catcherThrowVeloFps;
  const defenseTimeSec = cfg.stretchDeliverySec + catcherPopTimeSec + throwFlightSec;

  // Margin: positive = runner is safe, negative = runner is out
  const margin = defenseTimeSec - adjustedRunnerTime;

  // Sigmoid for success probability (sharp transition around margin=0)
  const successProb = 1 / (1 + Math.exp(-margin * 8));
  const success = Math.random() < successProb;

  return {
    success,
    runnerId: runner.id,
    runnerName: runner.name,
    fromBase,
    toBase,
    marginSec: margin,
    successProb,
  };
}

// ─── Pickoff attempts ────────────────────────────────────────────

export interface PickoffResult {
  attempted: boolean;
  out: boolean;
  runnerId: number;
  runnerName?: string;
  base: 'first' | 'second' | 'third';
}

/**
 * Evaluate whether the pitcher throws a pickoff attempt.
 * Probability depends on base, lead distance, runner speed, and pitcher hand.
 * If attempted, resolve whether the runner is picked off (rare).
 */
export function evaluatePickoff(
  runnersOnBase: { id: number; base: 'first' | 'second' | 'third'; speedSkill: number; piSkill: number; name?: string }[],
  pitcherHand: 'L' | 'R',
): PickoffResult | null {
  if (runnersOnBase.length === 0) return null;

  const cfg = CONFIG.stealing;

  for (const runner of runnersOnBase) {
    const base = runner.base;
    const baseKey = base as keyof typeof cfg.pickoffProb;
    let prob = cfg.pickoffProb[baseKey] ?? 0;

    const lead = leadDistanceFt(base, runner.speedSkill, runner.piSkill);
    if (lead > 8) prob += (lead - 8) * cfg.pickoffLeadBonusPerFt;
    if (runner.speedSkill >= 8) prob += cfg.pickoffFastRunnerBonus;
    if (base === 'first' && pitcherHand === 'L') prob += cfg.pickoffLhpBonusAt1B;

    if (Math.random() >= prob) continue;

    // Pickoff attempted — resolve out/safe
    let outProb: number = cfg.pickoffOutBaseProb;
    if (lead > 8) outProb += (lead - 8) * cfg.pickoffOutLeadPenaltyPerFt;
    outProb -= Math.max(0, runner.piSkill - 5) * cfg.pickoffOutPISavePerPt;
    outProb = Math.max(0.005, Math.min(0.10, outProb));

    return {
      attempted: true,
      out: Math.random() < outProb,
      runnerId: runner.id,
      runnerName: runner.name,
      base,
    };
  }
  return null;
}

// ─── Wild pitch / passed ball ────────────────────────────────────

export interface WildPitchResult {
  type: 'wild-pitch' | 'passed-ball';
  advancingRunners: { runnerId: number; runnerName?: string; from: string; to: string }[];
}

/**
 * Evaluate whether a wild pitch or passed ball occurs on this pitch.
 * If so, decide which runners advance based on speed + PI.
 */
export function evaluateWildPitchOrPassedBall(
  pitcherEye: number,
  catcherFielding: number,
  pitchIntent: 'in' | 'edge' | 'off',
  runnersOnBase: { id: number; base: 'first' | 'second' | 'third'; speedSkill: number; piSkill: number; name?: string }[],
): WildPitchResult | null {
  if (runnersOnBase.length === 0) return null;

  const cfg = CONFIG.stealing;

  // Wild pitch check (pitcher-caused)
  let wpProb = cfg.wildPitchBaseProb;
  wpProb += Math.max(0, 5 - pitcherEye) * cfg.wildPitchEyePenaltyPerPt;
  if (pitchIntent === 'off') wpProb += cfg.wildPitchOffZoneBonus;

  // Passed ball check (catcher-caused, independent)
  let pbProb = cfg.passedBallBaseProb;
  pbProb += Math.max(0, 5 - catcherFielding) * cfg.passedBallFieldingPenaltyPerPt;

  let eventType: 'wild-pitch' | 'passed-ball' | null = null;
  if (Math.random() < wpProb) eventType = 'wild-pitch';
  else if (Math.random() < pbProb) eventType = 'passed-ball';
  if (!eventType) return null;

  // Determine which runners advance
  const advancing: WildPitchResult['advancingRunners'] = [];
  for (const runner of runnersOnBase) {
    let advProb: number = cfg.wpAdvanceBaseProb;
    advProb += Math.max(0, runner.speedSkill - 5) * cfg.wpAdvanceSpeedBonusPerPt;
    advProb += Math.max(0, runner.piSkill - 5) * 0.02;
    advProb = Math.min(0.95, advProb);
    // R3 scoring on WP is very high probability (only 90 ft to home)
    if (runner.base === 'third') advProb = Math.min(0.98, advProb + 0.15);

    if (Math.random() < advProb) {
      const toBase = runner.base === 'first' ? 'second'
        : runner.base === 'second' ? 'third'
        : 'home';
      // Don't advance into an occupied base
      if (!runnersOnBase.some(r => r.id !== runner.id && r.base === toBase)) {
        advancing.push({
          runnerId: runner.id,
          runnerName: runner.name,
          from: runner.base,
          to: toBase,
        });
      }
    }
  }

  return { type: eventType, advancingRunners: advancing };
}

// ─── Manager signals (steal / bunt / hit-and-run) ────────────────

export interface ManagerSignal {
  type: 'steal' | 'bunt' | 'hit-and-run' | 'take' | 'swing-away';
  runner?: number;
  stealFrom?: 'first' | 'second';
  stealTo?: 'second' | 'third';
  reasoning: string;
}

/**
 * Evaluate whether to signal a steal, bunt, or hit-and-run.
 * Called before each pitch by the offensive manager.
 *
 * Hit-and-run exploits coverage holes:
 *   vs LH batter: SS covers 2B on the steal → hole at SS position
 *   vs RH batter: 2B covers 2B on the steal → hole at 2B position
 *   Power hitters (power ≥ 8) skip H&R — they just swing for the fences.
 */
export function evaluateSignal(
  runners: RunnerEntity[],
  batterSkills: { power: number; avg: number; speed: number; hand?: 'L' | 'R' | 'S' },
  situation: GameSituation,
  balls: number,
  strikes: number,
  pitcherHand?: 'L' | 'R',
  stealAggression: number = 1.0,
  hitAndRunFreq: number = 1.0,
): ManagerSignal {
  const cfg = CONFIG.stealing;
  const runnersOnBase = runners.filter(r => r.state.type === 'on-base');

  // ── Steal of 2B ──────────────────────────────────────────────
  const r1 = runnersOnBase.find(r =>
    r.state.type === 'on-base' &&
    r.state.base === 'first' &&
    r.speedFps >= sprintFtPerSec(cfg.minSpeedFor2B)
  );
  const secondOccupied = runnersOnBase.some(r =>
    r.state.type === 'on-base' && r.state.base === 'second'
  );

  if (r1 && !secondOccupied && situation.outs < 2) {
    let attemptProb = cfg.stealAttemptProb2B * stealAggression;
    if (pitcherHand === 'L') attemptProb *= 0.6;  // harder to run on LHP at 1B
    if (balls >= 2) attemptProb *= 1.3;  // favorable count bonus

    if (Math.random() < attemptProb) {
      return {
        type: 'steal',
        runner: r1.id,
        stealFrom: 'first',
        stealTo: 'second',
        reasoning: `Steal 2B — speed ${Math.round(r1.speedFps)} fps, ${pitcherHand ?? 'R'}HP`,
      };
    }
  }

  // ── Steal of 3B (rare) ───────────────────────────────────────
  const r2 = runnersOnBase.find(r =>
    r.state.type === 'on-base' &&
    r.state.base === 'second' &&
    r.speedFps >= sprintFtPerSec(cfg.minSpeedFor3B) &&
    (r.playIntelligence ?? 5) >= cfg.minPIFor3B
  );
  const thirdOccupied = runnersOnBase.some(r =>
    r.state.type === 'on-base' && r.state.base === 'third'
  );

  if (r2 && !thirdOccupied && situation.outs < 2 && Math.abs(situation.scoreDiff) <= 2) {
    let attemptProb = cfg.stealAttemptProb3B * stealAggression;
    if (pitcherHand === 'R') attemptProb *= 1.2;  // RHP back to 2B = slight edge

    if (Math.random() < attemptProb) {
      return {
        type: 'steal',
        runner: r2.id,
        stealFrom: 'second',
        stealTo: 'third',
        reasoning: `Steal 3B — elite speed+PI, ${pitcherHand ?? 'R'}HP`,
      };
    }
  }

  // ── Hit-and-run ──────────────────────────────────────────────
  // Runner on 1B breaks on the pitch; batter obligated to swing.
  // Exploits the coverage hole created when 2B/SS covers the bag.
  // Power hitters (≥8) just swing for the fences — no H&R needed.
  if (
    r1 && !secondOccupied &&
    batterSkills.power < 8 &&
    batterSkills.avg >= 6 &&
    situation.outs < 2 &&
    balls >= 1 && strikes <= 1
  ) {
    const hrProb = 0.08 * hitAndRunFreq;
    if (Math.random() < hrProb) {
      const hole = (batterSkills.hand === 'L') ? 'SS-side' : '2B-side';
      return {
        type: 'hit-and-run',
        runner: r1.id,
        stealFrom: 'first',
        stealTo: 'second',
        reasoning: `Hit and run — ${hole} hole opens, avg ${batterSkills.avg}`,
      };
    }
  }

  // ── Bunt ─────────────────────────────────────────────────────
  if (
    batterSkills.speed >= 7 &&
    batterSkills.power < 5 &&
    r1 && situation.outs === 0 &&
    Math.abs(situation.scoreDiff) <= 1
  ) {
    return {
      type: 'bunt',
      reasoning: 'Sac bunt — advancing runner to scoring position',
    };
  }

  // ── Take (3-0 count) ────────────────────────────────────────
  if (balls === 3 && strikes === 0) {
    return { type: 'take', reasoning: '3-0 take sign' };
  }

  return { type: 'swing-away', reasoning: 'No special signal — swing away' };
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
  if (runnersOnBase.includes('first')) {
    return { walk: false, reasoning: 'First base occupied' };
  }

  const batterThreat = batterSkills.power * 0.6 + batterSkills.avg * 0.4;
  const onDeckThreat = onDeckSkills
    ? onDeckSkills.power * 0.6 + onDeckSkills.avg * 0.4
    : 5;

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
