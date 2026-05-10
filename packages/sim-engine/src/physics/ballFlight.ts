/**
 * Ball flight physics — converts (exitVelo, launchAngle, sprayAngle)
 * into a landing point and hang time.
 *
 * 2.5D model: the ball launches from `contactHeightFt` (≈3 ft, bat
 * height in the strike zone) and follows projectile motion with drag
 * until it reaches ground level (y=0). This single change eliminates
 * the old hard 5° grounder cutoff — the physics naturally determines
 * whether the ball is a grounder (negative LA, hits dirt fast) or a
 * liner/fly (positive LA, stays airborne).
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

/** Ground-distance + hang time using 2.5D projectile model with h₀. */
export function flight(input: FlightInput): FlightResult {
  const { exitVeloMph, launchAngleDeg, sprayAngleDeg } = input;
  const v0 = exitVeloMph * CONFIG.flight.mphToFps;
  const g = CONFIG.flight.gravityFtPerSec2;
  const h0 = CONFIG.battedBall.contactHeightFt;

  // Clamp angle for trig (projectile math gets weird above ~70°)
  const effectiveLA = Math.min(70, launchAngleDeg);
  const angleRad = (effectiveLA * Math.PI) / 180;
  const vVert = v0 * Math.sin(angleRad);   // vertical component (ft/s)
  const vHoriz = v0 * Math.cos(angleRad);  // horizontal component (ft/s)

  // ─── Distance with drag ────────────────────────────────────────
  // Uses a Statcast-calibrated drag factor that scales linearly with
  // exit velocity. Faster balls lose proportionally more to drag:
  //   119 mph → ×0.55 (line drives hammered by air resistance)
  //    90 mph → ×0.67 (softer contact retains more)
  //    60 mph → ×0.80 (weak pop-ups, barely any drag)
  //
  // Distance formula: vacRange × dragFactor
  //   vacRange = v² × sin(2θ) / g   (standard ground-level projectile)
  //   dragFactor = clamp(0.55, 0.95, 1.05 - mph × 0.0042)
  const vacRange = (v0 * v0 * Math.sin(2 * angleRad)) / g;
  const dragFactor = Math.max(0.55, Math.min(0.95, 1.05 - exitVeloMph * 0.0042));
  let distanceFt = Math.max(0, vacRange * dragFactor);

  // ─── Hang time from contact height ────────────────────────────
  // Quadratic with h₀: ball launches from bat height (~3 ft), not
  // ground level. This is critical for grounder classification — a
  // negative LA ball lands in ~0.15-0.3s (short parabola from h₀),
  // while the symmetric formula 2vy/g gives 0 for LA=0.
  //   h(t) = h₀ + vy·t - ½g·t² = 0
  //   t = (vy + √(vy² + 2gh₀)) / g
  const disc = vVert * vVert + 2 * g * h0;
  let hangTime = disc > 0
    ? (vVert + Math.sqrt(disc)) / g
    : Math.sqrt(2 * h0 / g);  // fallback: pure drop from h₀
  hangTime = Math.max(0.15, hangTime);

  // Peak height: apex above ground from vacuum kinematics.
  // For negative LA (grounders), peak is at bat height.
  const peakHeight = vVert > 0
    ? h0 + (vVert * vVert) / (2 * g)
    : h0;

  // ─── Grounder classification ──────────────────────────────────
  // No more hard cutoff! A "grounder" is any ball that lands close
  // enough to home plate that it was effectively rolling on the grass.
  // Physics-based: negative LA → lands in ~0.15-0.25s at 10-30 ft;
  // 0° LA → lands at ~0.4s at ~55 ft; 3° LA → ~0.5s at ~65 ft.
  // We classify as grounder if hang time < 0.6s AND distance < 90 ft
  // (roughly the infield). This covers all the traditional "grounders"
  // while letting low liners (5-10° LA) be proper fly balls.
  const isGrounder = hangTime < 0.6 && distanceFt < 90;

  // For grounders, adjust: the ball decelerates on grass from contact
  // velocity (it bounces off the dirt and rolls). Scale distance by
  // friction so weak contact doesn't roll to the OF unrealistically.
  if (isGrounder) {
    const evNorm = Math.max(0, Math.min(1, (exitVeloMph - 50) / 60));  // 0..1 over [50,110], clamped
    distanceFt = 20 + evNorm * 130;  // max ~150 ft for hardest grounders
    // Grounder hang time = travel time along the ground with friction.
    const decel = 10;  // ft/sec² avg deceleration on grass
    const groundV0 = vHoriz * Math.cos(Math.abs(angleRad) * 0.3); // bounce kills some speed
    const disc2 = groundV0 * groundV0 - 2 * decel * distanceFt;
    hangTime = disc2 > 0
      ? (groundV0 - Math.sqrt(disc2)) / decel
      : distanceFt / Math.max(20, groundV0 * 0.45);
    hangTime = Math.max(0.3, hangTime);
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
    // Horizontal velocity at contact, attenuated by drag in flight.
    // We approximate: ball loses ~half its horizontal velocity to drag
    // on the way down (matches Statcast: a 100mph drive lands at ~70mph).
    const vHorizLanding = vHoriz * 0.55;
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
