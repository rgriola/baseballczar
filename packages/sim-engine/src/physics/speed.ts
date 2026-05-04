/**
 * Player movement timing — the SINGLE source of truth for how fast
 * any player moves, whether they're running bases or fielding.
 *
 * One body, one speed: `sprintFtPerSec(speed)` returns the same
 * top-speed for a player regardless of context.
 *
 * Acceleration curve: players don't instantly hit top speed. They
 * ramp linearly from 0 to `sprintFtPerSec` over `accelTimeSec`.
 * `accelAwareTimeSec(dist, topSpeed)` solves the time accounting
 * for that ramp. Both baserunning and fielding use this solver.
 *
 * Defense contribution (fielding only): defense skill improves the
 * fielder's *jump* (reaction time) and *route efficiency* (shorter
 * path to the ball). It does NOT increase foot speed — that's the
 * `speed` skill's job alone.
 *
 * Base coordinates are in feet, origin = home plate.
 *   home  (0, 0)
 *   1B    (90 cos45, 90 sin45) = (63.6, 63.6)
 *   2B    (0, 127.3)
 *   3B    (-63.6, 63.6)
 */
import { CONFIG } from '../config';
import type { Hand } from '../types';

export const BASE_COORDS_FT = { // expressed in  feet. 
  home: { x: 0, y: 0 },
  first: { x: 63.6, y: 63.6 },
  second: { x: 0, y: 127.3 },
  third: { x: -63.6, y: 63.6 },
} as const;

export type BaseName = keyof typeof BASE_COORDS_FT;

/**
 * Top sprint speed for a given speed skill. Linear interpolation
 * between CONFIG.runner.minFtPerSec (skill 1) and maxFtPerSec (skill 10).
 * Used for BOTH baserunning and fielding — same body, same speed.
 */
export function sprintFtPerSec(speedSkill: number): number {
  const { minFtPerSec, maxFtPerSec } = CONFIG.runner;
  const t = (Math.max(1, Math.min(10, speedSkill)) - 1) / 9;
  return minFtPerSec + t * (maxFtPerSec - minFtPerSec);
}

/**
 * Time to cover `distFt` feet with a linear acceleration ramp.
 *
 * Phase 1 (accel): speed ramps 0 → topSpeed over `accelTimeSec`.
 *   Distance covered = ½ · topSpeed · accelTimeSec.
 * Phase 2 (cruise): constant `topSpeed`.
 *
 * If the total distance is within the accel phase, we solve the
 * quadratic: d = ½ · (topSpeed / accelTime) · t².
 */
export function accelAwareTimeSec(distFt: number, topSpeedFps: number): number {
  const ta = CONFIG.runner.accelTimeSec;
  if (ta <= 0) return distFt / topSpeedFps;  // no accel curve
  const accel = topSpeedFps / ta;             // ft/sec²
  const dAccel = 0.5 * accel * ta * ta;       // distance covered during full ramp

  if (distFt <= dAccel) {
    // Entire run is within the acceleration phase: d = ½·a·t² → t = √(2d/a)
    return Math.sqrt(2 * distFt / accel);
  }
  // Full ramp + cruise for the remainder
  const dCruise = distFt - dAccel;
  return ta + dCruise / topSpeedFps;
}

/** Distance in feet between two bases. */
export function baseDistanceFt(from: BaseName, to: BaseName): number {
  const a = BASE_COORDS_FT[from];
  const b = BASE_COORDS_FT[to];
  return Math.hypot(b.x - a.x, b.y - a.y);
}

/**
 * Time for a runner to travel from `from` to `to`.
 * `fromContact` true means starting from the batter's box (no lead).
 * Lefty batters get a head-start advantage to 1B only.
 * Uses the acceleration-aware solver so short-distance sprints
 * are penalized by the ramp-up time.
 */
export function runnerTimeSec(
  from: BaseName,
  to: BaseName,
  speedSkill: number,
  opts: { fromContact?: boolean; hand?: Hand } = {},
): number {
  const speed = sprintFtPerSec(speedSkill);
  let dist = baseDistanceFt(from, to);
  let time = accelAwareTimeSec(dist, speed);
  if (opts.fromContact) {
    time += CONFIG.runner.reactionToBatSec;
    if (opts.hand === 'L' && to === 'first') {
      time -= CONFIG.runner.leftyHeadStartSec;
    }
  } else {
    // Already on base with a secondary lead — reduce distance
    dist = Math.max(0, dist - CONFIG.runner.secondaryLeadFt);
    time = accelAwareTimeSec(dist, speed);
  }
  return Math.max(0, time);
}

/**
 * Time for a FIELDER to reach a point on the field.
 *
 * Foot speed = sprintFtPerSec(speed) — same as baserunning.
 * Defense contributes:
 *   - Reaction time bonus: good defenders read the ball faster
 *   - Route efficiency: good defenders take shorter paths
 *
 * @param fielderPt  Fielder's starting position (ft, origin = home)
 * @param targetPt   Where the fielder needs to get to
 * @param speedSkill Player's speed skill (1–10)
 * @param speedSkill Player's speed skill (1–10)
 * @param fieldingSkill Player's fielding skill (1–10)
 * @returns Time in seconds from contact to arriving at targetPt
 */
export function fielderReachTimeSec(
  fielderPt: { x: number; y: number },
  targetPt: { x: number; y: number },
  speedSkill: number,
  fieldingSkill: number,
): number {
  const dist = Math.hypot(targetPt.x - fielderPt.x, targetPt.y - fielderPt.y);
  const topSpeed = sprintFtPerSec(speedSkill);

  // Fielding → reaction bonus: each point above 5 shaves time off the
  // initial read. Skill 10 = 0.25s reaction, Skill 1 = 0.61s.
  const reactionBonus = (fieldingSkill - 5) * CONFIG.fielder.defenseReactionBonusSec;
  const reaction = Math.max(0.1, CONFIG.fielder.reactionSec - reactionBonus);

  // Fielding → route efficiency: bad routes add distance (up to ~8%).
  const routeMul = CONFIG.fielder.routeBase
    + (fieldingSkill - 5) * CONFIG.fielder.routeLeverage;
  const effectiveDist = dist * Math.max(0.9, routeMul);

  return reaction + accelAwareTimeSec(effectiveDist, topSpeed);
}
