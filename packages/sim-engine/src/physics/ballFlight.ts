/**
 * Ball flight physics — converts (exitVelo, launchAngle, sprayAngle)
 * into a landing point and hang time. Simplified projectile motion
 * with a drag term tuned so 100mph @ 28° travels ~400 ft (matches
 * Statcast averages for an MLB barrel).
 *
 * Coordinate system (feet, origin = home plate):
 *   +x = toward right field foul line
 *   +y = toward center field
 *   sprayAngleDeg  0°  = straight CF
 *   sprayAngleDeg +90° = RF foul line
 *   sprayAngleDeg -90° = LF foul line
 */
import { CONFIG } from '../config';
import { wallDistanceFt, isFair } from './park';

export interface FlightInput {
  exitVeloMph: number;
  launchAngleDeg: number;
  sprayAngleDeg: number;
}

export interface FlightResult {
  distanceFt: number;
  hangTimeSec: number;
  landingPoint: { x: number; y: number };
  peakHeightFt: number;
  isHomeRun: boolean;
  isFoul: boolean;
}

/** Ground-distance + hang time using simplified drag model. */
export function flight(input: FlightInput): FlightResult {
  const { exitVeloMph, launchAngleDeg, sprayAngleDeg } = input;
  const v0 = exitVeloMph * CONFIG.flight.mphToFps;
  const g = CONFIG.flight.gravityFtPerSec2;

  // Grounders (LA < 5°): no real flight; ball rolls along spray angle.
  // Rollout distance scales with EV; capped at the wall on that line.
  // Stronger contact reaches the OF (BABIP becomes a function of fielder position).
  const isGrounder = launchAngleDeg < 5;
  let distanceFt: number;
  let hangTime: number;
  let peakHeight: number;

  if (isGrounder) {
    // 60mph weak roller ≈ 30ft to mound; 105mph rocket ≈ 220ft to OF
    const evNorm = Math.max(0, (exitVeloMph - 50) / 60);  // 0..1 over [50,110]
    distanceFt = 30 + evNorm * 220;
    // Hang time = time for the ball to travel `distanceFt` along the
    // ground, decelerating from v0 at ~10 ft/s² (grass + bounces).
    // Solving d = v0·t − ½·a·t² for t gives:
    //     t = (v0 − √(v0² − 2·a·d)) / a
    // This couples time to physics so a 112mph hot shot to the OF
    // takes ~1.6s rather than the previous fixed 0.4s.
    const decel = 10;  // ft/sec² avg deceleration on grass
    const disc = v0 * v0 - 2 * decel * distanceFt;
    hangTime = disc > 0
      ? (v0 - Math.sqrt(disc)) / decel
      // Ball would decelerate to a stop before reaching `distanceFt`
      // (very weak roller). Fall back to average-speed approximation.
      : distanceFt / Math.max(20, v0 * 0.45);
    hangTime = Math.max(0.3, hangTime);
    peakHeight = 2;
  } else {
    const angleRad = (Math.min(50, launchAngleDeg) * Math.PI) / 180;
    // Vacuum-style range as base
    const vacRange = (v0 * v0 * Math.sin(2 * angleRad)) / g;
    hangTime = (2 * v0 * Math.sin(angleRad)) / g;
    const dragLoss = CONFIG.flight.dragCoeff * v0 * v0;
    distanceFt = Math.max(0, vacRange - dragLoss);
    peakHeight = (v0 * Math.sin(angleRad)) ** 2 / (2 * g);
  }

  // Project landing point onto field plane.
  // Convention (consistent end-to-end across battedBall + park):
  //   sprayAngleDeg    0° → straight CF (+y)
  //   sprayAngleDeg  +45° → RF foul line (+x)
  //   sprayAngleDeg  -45° → LF foul line (-x)
  //   |spray| > 45° → foul ball
  const sprayRad = (sprayAngleDeg * Math.PI) / 180;
  const x = distanceFt * Math.sin(sprayRad);
  const y = distanceFt * Math.cos(sprayRad);

  const isFoul = !isFair(sprayAngleDeg);
  const wall = wallDistanceFt(sprayAngleDeg);
  // Need both: travelled past wall AND launched high enough to clear it
  const isHomeRun = !isFoul && distanceFt > wall && peakHeight > CONFIG.park.wallHeightFt;

  return {
    distanceFt,
    hangTimeSec: hangTime,
    landingPoint: { x, y },
    peakHeightFt: peakHeight,
    isHomeRun,
    isFoul,
  };
}
