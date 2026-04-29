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
  /** Where the ball comes to rest if no fielder intercepts the roll.
   *  For grounders this equals `landingPoint`. For fly balls that drop
   *  fair, the ball bounces past `landingPoint` along its spray vector,
   *  decelerates on grass, and either stops naturally or strikes the
   *  outfield wall — in which case it ricochets back toward the
   *  infield with a fraction of its remaining velocity. Always inside
   *  the park boundary. */
  restPoint: { x: number; y: number };
  /** Distance the ball rolls AFTER landing, before either stopping
   *  naturally or hitting the wall. 0 for grounders (already in
   *  `distanceFt`) and HRs (left the field of play). For wall-bounces
   *  this is the TOTAL ground covered (out to wall + ricochet back),
   *  not the displacement from landing. */
  rollDistanceFt: number;
  /** Horizontal speed (ft/sec) at the moment the ball touches grass.
   *  Used by the OF pursuit solver to compute time-along-roll. */
  landingSpeedFps: number;
  /** If the ball reached the wall with energy to spare, this is the
   *  point on the wall it struck (in engine feet). The ball then
   *  ricochets back along the spray vector with `wallBounceKeepFrac`
   *  of its at-wall velocity. Undefined when the ball stopped before
   *  reaching the wall, on grounders, foul balls, and HRs. */
  wallHitPoint?: { x: number; y: number };
  /** Ball speed (ft/sec) the instant after the wall ricochet —
   *  the back-traveling segment starts at this velocity and decelerates
   *  with `grassDecelFtPerSec2`. Undefined when no wall hit. */
  wallBounceSpeedFps?: number;
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

  // ─── Post-landing roll ─────────────────────────────────────────
  // Grounders already include the rollout in `distanceFt`; HRs leave
  // the field; fouls are dead. For fly balls that drop fair, the ball
  // retains a fraction of its forward velocity at landing and rolls
  // along the spray vector. If the natural roll exceeds the room to
  // the wall, the ball strikes the fence and ricochets back toward
  // the infield with `wallBounceKeepFrac` of its at-wall velocity.
  let rollDistanceFt = 0;
  let landingSpeedFps = 0;
  let wallHitPoint: { x: number; y: number } | undefined;
  let wallBounceSpeedFps: number | undefined;
  // Net displacement-from-landing AT REST (signed along spray; positive
  // = toward the wall, can go negative if the ricochet kicks the ball
  // back past `landingPoint`).
  let restDispFt = 0;
  if (!isGrounder && !isHomeRun && !isFoul) {
    const angleRad = (Math.min(50, launchAngleDeg) * Math.PI) / 180;
    // Horizontal velocity at contact, attenuated by drag in flight.
    // We approximate: ball loses ~half its horizontal velocity to drag
    // on the way down (matches Statcast: a 100mph drive lands at ~70mph).
    const vHorizContact = v0 * Math.cos(angleRad);
    const vHorizLanding = vHorizContact * 0.55;
    landingSpeedFps = vHorizLanding * CONFIG.flight.roll.bounceKeepFrac;
    const decel = CONFIG.flight.roll.grassDecelFtPerSec2;
    const naturalRoll = (landingSpeedFps * landingSpeedFps) / (2 * decel);
    const roomToWall = Math.max(0, wall - distanceFt);
    if (naturalRoll <= roomToWall) {
      // Ball stops on the grass before the wall — simple monotonic roll.
      rollDistanceFt = naturalRoll;
      restDispFt = naturalRoll;
    } else {
      // Ball reaches the wall with energy to spare. v² = vLand² − 2·a·d.
      const vAtWallSq = landingSpeedFps * landingSpeedFps - 2 * decel * roomToWall;
      const vAtWall = Math.sqrt(Math.max(0, vAtWallSq));
      // Ricochet keeps a fraction of velocity (padded MLB walls absorb
      // a lot of energy — see CONFIG comment).
      const vBounce = vAtWall * CONFIG.flight.roll.wallBounceKeepFrac;
      wallBounceSpeedFps = vBounce;
      const bounceDist = (vBounce * vBounce) / (2 * decel);
      // Wall hit point is on the spray ray at distance `wall`.
      wallHitPoint = {
        x: wall * Math.sin(sprayRad),
        y: wall * Math.cos(sprayRad),
      };
      // Total ground covered = out to wall + back toward infield.
      rollDistanceFt = roomToWall + bounceDist;
      // Net displacement from landing (positive = toward wall).
      restDispFt = roomToWall - bounceDist;
    }
  }
  const restPoint = isGrounder
    ? { x, y }
    : {
        x: (distanceFt + restDispFt) * Math.sin(sprayRad),
        y: (distanceFt + restDispFt) * Math.cos(sprayRad),
      };

  return {
    distanceFt,
    hangTimeSec: hangTime,
    landingPoint: { x, y },
    peakHeightFt: peakHeight,
    isHomeRun,
    isFoul,
    restPoint,
    rollDistanceFt,
    landingSpeedFps,
    wallHitPoint,
    wallBounceSpeedFps,
  };
}
