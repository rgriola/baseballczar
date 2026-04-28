/**
 * Park geometry. Wall distance varies smoothly with spray angle.
 *   sprayAngleDeg: 0° = LF foul line, 45° = straightaway CF, 90° = RF foul line.
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

/** Linear interpolate between four anchor points (LL, LCF, CF, RCF, RL). */
export function wallDistanceFt(sprayAngleDeg: number, park: ParkGeometry = DEFAULT_PARK): number {
  const a = Math.max(0, Math.min(90, sprayAngleDeg));
  // Anchors at 0°, 22.5°, 45°, 67.5°, 90°
  if (a <= 22.5) {
    const t = a / 22.5;
    return park.leftLineFt + t * (park.leftCenterFt - park.leftLineFt);
  }
  if (a <= 45) {
    const t = (a - 22.5) / 22.5;
    return park.leftCenterFt + t * (park.centerFt - park.leftCenterFt);
  }
  if (a <= 67.5) {
    const t = (a - 45) / 22.5;
    return park.centerFt + t * (park.rightCenterFt - park.centerFt);
  }
  const t = (a - 67.5) / 22.5;
  return park.rightCenterFt + t * (park.rightLineFt - park.rightCenterFt);
}

/** True if the spray angle is within fair territory (0..90 inclusive). */
export function isFair(sprayAngleDeg: number): boolean {
  return sprayAngleDeg >= 0 && sprayAngleDeg <= 90;
}
