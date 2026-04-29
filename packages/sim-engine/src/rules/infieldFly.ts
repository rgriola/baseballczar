/**
 * Infield Fly Rule.
 *
 * Conditions (all must be true):
 *   - Less than 2 outs
 *   - Force at 3B exists: runners on 1B+2B, OR bases loaded
 *   - Ball is fair
 *   - Ball is a pop-up (high LA, short distance) — judgement call,
 *     parameterized as: launchAngleDeg >= 50 AND distanceFt <= 160
 *     (infield depth ~ 150 ft, +10 ft into the OF cut).
 *
 * Effect: the batter is automatically out the moment the umpire calls
 * it, regardless of whether the ball is caught. Runners may advance
 * at their own risk only after the ball is touched/lands. We model
 * this as: result = 'pop-out', batter out, runners hold (no
 * advancement, no extra outs charged).
 *
 * Purpose: prevents the dirty play where a fielder intentionally
 * drops the pop-up to start an easy double or triple play on the
 * forced runners.
 */
import type { BattedBall } from '../types';

export interface InfieldFlyContext {
  outs: number;
  /** [r1, r2, r3] occupancy — values can be anything truthy/null. */
  bases: readonly (unknown | null)[];
  battedBall: BattedBall | undefined;
}

/** Tunables — kept here so they're easy to find and adjust. */
export const INFIELD_FLY = {
  minLaunchAngleDeg: 50,
  maxDistanceFt: 160,
} as const;

export function isInfieldFly(ctx: InfieldFlyContext): boolean {
  if (ctx.outs >= 2) return false;
  const bb = ctx.battedBall;
  if (!bb) return false;
  if (bb.isFoul || bb.isHomeRun) return false;
  // Force at 3B: r1 AND r2 occupied (regardless of r3).
  const [r1, r2] = ctx.bases;
  if (!r1 || !r2) return false;
  if (bb.launchAngleDeg < INFIELD_FLY.minLaunchAngleDeg) return false;
  if (bb.distanceFt > INFIELD_FLY.maxDistanceFt) return false;
  return true;
}
