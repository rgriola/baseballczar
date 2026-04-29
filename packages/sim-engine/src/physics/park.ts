/**
 * Park geometry. Wall distance varies smoothly with spray angle.
 * Convention (now consistent end-to-end):
 *   sprayAngleDeg  -45° = LF foul line
 *   sprayAngleDeg    0° = straightaway CF
 *   sprayAngleDeg  +45° = RF foul line
 */
import { CONFIG } from '../config';

export interface ParkGeometry {
  leftLineFt: number;
  leftCenterFt: number;
  centerFt: number;
  rightCenterFt: number;
  rightLineFt: number;
  wallHeightFt: number;
}

const DEFAULT_PARK: ParkGeometry = {
  leftLineFt: CONFIG.park.leftLineFt,
  leftCenterFt: CONFIG.park.leftCenterFt,
  centerFt: CONFIG.park.centerFt,
  rightCenterFt: CONFIG.park.rightCenterFt,
  rightLineFt: CONFIG.park.rightLineFt,
  wallHeightFt: CONFIG.park.wallHeightFt,
};

/**
 * Linear interpolate wall distance between five anchor points across the
 * fair wedge: LL (-45°), LCF (-22.5°), CF (0°), RCF (+22.5°), RL (+45°).
 */
export function wallDistanceFt(sprayAngleDeg: number, park: ParkGeometry = DEFAULT_PARK): number {
  const a = Math.max(-45, Math.min(45, sprayAngleDeg));
  if (a <= -22.5) {
    const t = (a + 45) / 22.5; // 0..1 from LL to LCF
    return park.leftLineFt + t * (park.leftCenterFt - park.leftLineFt);
  }
  if (a <= 0) {
    const t = (a + 22.5) / 22.5; // 0..1 from LCF to CF
    return park.leftCenterFt + t * (park.centerFt - park.leftCenterFt);
  }
  if (a <= 22.5) {
    const t = a / 22.5; // 0..1 from CF to RCF
    return park.centerFt + t * (park.rightCenterFt - park.centerFt);
  }
  const t = (a - 22.5) / 22.5; // 0..1 from RCF to RL
  return park.rightCenterFt + t * (park.rightLineFt - park.rightCenterFt);
}

/** True if the spray angle is within the fair wedge (±45° of dead CF). */
export function isFair(sprayAngleDeg: number): boolean {
  return sprayAngleDeg >= -45 && sprayAngleDeg <= 45;
}
