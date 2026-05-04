/**
 * Throw timing. Distance / velocity, plus release time.
 * Outfielders get a crow-hop bonus (extra mph, extra release).
 */
import { CONFIG, type Position } from '../config';

const OUTFIELD: Position[] = ['LF', 'CF', 'RF'];

export function throwVelocityMph(position: Position, throwingSkill: number): number {
  const base = CONFIG.throwVeloBaseMph[position];
  // TH skill: ±2 mph per point above/below 5 (range ±10 mph across 1-10)
  const skillBonus = (throwingSkill - 5) * 2;
  const crowHop = OUTFIELD.includes(position) ? CONFIG.outfieldCrowHopMph : 0;
  return base + skillBonus + crowHop;
}

export function releaseTimeSec(position: Position): number {
  return OUTFIELD.includes(position)
    ? CONFIG.outfieldReleaseTimeSec
    : CONFIG.releaseTimeSec;
}

/** Total time from "fielder has the ball" to "ball arrives at target". */
export function throwTimeSec(
  fromPt: { x: number; y: number },
  toPt: { x: number; y: number },
  position: Position,
  throwingSkill: number,
): number {
  const dx = toPt.x - fromPt.x;
  const dy = toPt.y - fromPt.y;
  const distFt = Math.hypot(dx, dy);
  const velFps = throwVelocityMph(position, throwingSkill) * CONFIG.flight.mphToFps;
  return releaseTimeSec(position) + distFt / velFps;
}
