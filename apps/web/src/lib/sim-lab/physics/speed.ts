/**
 * Runner timing. Sprint speed by skill, with lefty head-start to 1B.
 * Base coordinates are in feet, origin = home plate.
 *   home  (0, 0)
 *   1B    (90 cos45, 90 sin45) = (63.6, 63.6)
 *   2B    (0, 127.3)
 *   3B    (-63.6, 63.6)
 */
import { CONFIG } from '../config';
import type { Hand } from '../types';

export const BASE_COORDS_FT = {
  home: { x: 0, y: 0 },
  first: { x: 63.6, y: 63.6 },
  second: { x: 0, y: 127.3 },
  third: { x: -63.6, y: 63.6 },
} as const;

export type BaseName = keyof typeof BASE_COORDS_FT;

export function sprintFtPerSec(speedSkill: number): number {
  const { minFtPerSec, maxFtPerSec } = CONFIG.runner;
  const t = (Math.max(1, Math.min(10, speedSkill)) - 1) / 9;
  return minFtPerSec + t * (maxFtPerSec - minFtPerSec);
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
 */
export function runnerTimeSec(
  from: BaseName,
  to: BaseName,
  speedSkill: number,
  opts: { fromContact?: boolean; hand?: Hand } = {},
): number {
  const dist = baseDistanceFt(from, to);
  const speed = sprintFtPerSec(speedSkill);
  let time = dist / speed;
  if (opts.fromContact) {
    time += CONFIG.runner.reactionToBatSec;
    if (opts.hand === 'L' && to === 'first') {
      time -= CONFIG.runner.leftyHeadStartSec;
    }
  } else {
    // Already on base with a lead
    time = (dist - CONFIG.runner.secondaryLeadFt) / speed;
  }
  return Math.max(0, time);
}
