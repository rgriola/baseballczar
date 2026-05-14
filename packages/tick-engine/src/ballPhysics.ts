// Last touched by agent: 2026-05-05T06:10:11Z
/**
 * Per-tick ball physics — 3D Euler integration with drag and gravity.
 *
 * Unlike the pre-computed ballFlight.ts (which outputs final distance/hang),
 * this runs one step at a time so the ball's position is known every frame.
 * The renderer reads ball.pos each tick to draw the sprite.
 */
import type { BallEntity, Point2D } from './entities';

import { testWallCollision, reflectVelocity } from './spatial';

const G = 32.174;               // gravity (ft/s²)
const MPH_TO_FPS = 5280 / 3600;

// Drag factor constants (same as the user's calculator):
//   dragFactor = clamp(0.55, 0.95, 1.05 - mph * 0.0042)
// We apply drag per-tick as a velocity damping so the ball decelerates
// smoothly rather than flying at full speed then stopping.
//
// For a ball at v ft/s, the drag acceleration each tick is:
//   a_drag = kDrag * v²  (opposing velocity)
// kDrag is tuned so the total distance matches the drag-factor formula.
const K_DRAG = 0.00180;  // ½ρCdA/m from the aerodynamic model

// Surface friction for rolling balls (ft/s²)
const GRASS_DECEL = 14;          // outfield grass
const DIRT_DECEL = 9;            // infield dirt skin — lower friction, ball skips faster
const BOUNCE_RESTITUTION = 0.35;  // vertical velocity retained on bounce
const HORIZ_BOUNCE = 0.75;        // horizontal velocity retained on bounce
const CONTACT_HEIGHT_FT = 3;
const CALIBRATION_DT = 1 / 120;
const CALIBRATION_MAX_SEC = 12;
const CALIBRATION_ITERS = 5;

// Infield dirt geometry: roughly a 95-ft radius arc from the mound center
// (61 ft from home). Points inside this radius are on dirt.
const DIRT_CENTER: Point2D = { x: 0, y: 61 };  // pitcher's mound
const DIRT_RADIUS = 95;

/** Is a ground-level point on infield dirt vs outfield grass? */
function isOnDirt(pos: Point2D): boolean {
  const dx = pos.x - DIRT_CENTER.x;
  const dy = pos.y - DIRT_CENTER.y;
  return dx * dx + dy * dy <= DIRT_RADIUS * DIRT_RADIUS;
}

/** Get the surface deceleration at a given ground position. */
function surfaceDecel(pos: Point2D): number {
  return isOnDirt(pos) ? DIRT_DECEL : GRASS_DECEL;
}

/**
 * Launch the ball from bat contact. Converts exit velocity / launch angle /
 * spray angle into a 3D velocity vector and sets the ball state to in-flight.
 */
export interface LaunchBallProfile {
  targetDistanceFt?: number;
  targetHangTimeSec?: number;
  targetPeakHeightFt?: number;
  minPeakHeightFt?: number;
}

interface FlightProbe {
  distanceFt: number;
  hangTimeSec: number;
  peakHeightFt: number;
}

function probeFlight(vHoriz: number, vVert: number): FlightProbe {
  let s = 0;
  let z = CONTACT_HEIGHT_FT;
  let vx = Math.max(1, vHoriz);
  let vz = vVert;
  let t = 0;
  let peak = z;

  while (t < CALIBRATION_MAX_SEC) {
    const speed = Math.hypot(vx, vz);
    if (speed > 0.1) {
      const dragMag = K_DRAG * speed * speed;
      const ax = -(dragMag * vx) / speed;
      const az = -(dragMag * vz) / speed - G;
      vx += ax * CALIBRATION_DT;
      vz += az * CALIBRATION_DT;
    } else {
      vz -= G * CALIBRATION_DT;
    }

    s += vx * CALIBRATION_DT;
    z += vz * CALIBRATION_DT;
    t += CALIBRATION_DT;
    if (z > peak) peak = z;
    if (z <= 0) break;
  }

  return {
    distanceFt: Math.max(0, s),
    hangTimeSec: Math.max(CALIBRATION_DT, t),
    peakHeightFt: Math.max(peak, CONTACT_HEIGHT_FT),
  };
}

function calibrateLaunch(
  baseHoriz: number,
  baseVert: number,
  profile?: LaunchBallProfile,
): { vHoriz: number; vVert: number } {
  if (!profile) return { vHoriz: baseHoriz, vVert: baseVert };

  const targetDistanceFt = profile.targetDistanceFt;
  const targetHangTimeSec = profile.targetHangTimeSec;

  if (targetDistanceFt == null || targetHangTimeSec == null
    || targetDistanceFt <= 0 || targetHangTimeSec <= 0) {
    return { vHoriz: baseHoriz, vVert: baseVert };
  }

  // ─── Grounders (negative or near-zero vertical) ─────────────────
  // For grounders the ball leaves the bat downward and bounces off
  // the dirt. The ball's total distance comes from rolling with
  // friction — NOT from trying to fly the full distance ballistically.
  // Using targetDistanceFt / targetHangTimeSec here produced absurd
  // speeds (e.g. 250ft / 0.3s = 833 ft/s = 568 mph). Instead, use
  // the raw horizontal component from exit velocity: a 100 mph
  // grounder at -10° LA → 144 ft/s horizontal, which is physically
  // correct. The bounce + roll physics in tickBall handles
  // deceleration naturally via friction and ground absorption.
  if (baseVert <= 0) {
    const gentleVert = -G * 0.15;  // lands in ~0.3s from 3ft → realistic dirt hit
    // Use the raw EV horizontal component, clamped to sane range.
    // baseHoriz = exitVeloMph * MPH_TO_FPS * cos(launchAngle)
    const vHoriz = Math.max(10, Math.min(baseHoriz, 200));
    return { vHoriz, vVert: gentleVert };
  }

  // ─── Fly balls / line drives (positive vertical) ────────────────
  let vHoriz = Math.max(5, baseHoriz);
  let vVert = baseVert;

  for (let i = 0; i < CALIBRATION_ITERS; i++) {
    const probe = probeFlight(vHoriz, vVert);

    if (probe.distanceFt > 1) {
      const distScale = Math.max(0.6, Math.min(1.8, targetDistanceFt / probe.distanceFt));
      vHoriz *= distScale;
    }

    if (probe.hangTimeSec > 0.05) {
      const hangScale = Math.max(0.55, Math.min(1.8, targetHangTimeSec / probe.hangTimeSec));
      vVert *= hangScale;
    }
  }

  let probe = probeFlight(vHoriz, vVert);
  const desiredPeakFt = Math.max(
    profile.minPeakHeightFt ?? 0,
    profile.targetPeakHeightFt != null ? profile.targetPeakHeightFt * 0.9 : 0,
  );

  if (desiredPeakFt > CONTACT_HEIGHT_FT && probe.peakHeightFt < desiredPeakFt) {
    const currentLift = Math.max(0.25, probe.peakHeightFt - CONTACT_HEIGHT_FT);
    const neededLift = desiredPeakFt - CONTACT_HEIGHT_FT;
    vVert *= Math.sqrt(neededLift / currentLift);
    probe = probeFlight(vHoriz, vVert);

    if (probe.distanceFt > 1) {
      const distScale = Math.max(0.6, Math.min(1.8, targetDistanceFt / probe.distanceFt));
      vHoriz *= distScale;
    }
  }

  return {
    vHoriz: Math.max(5, vHoriz),
    vVert,
  };
}

export function launchBall(
  ball: BallEntity,
  exitVeloMph: number,
  launchAngleDeg: number,
  sprayAngleDeg: number,
  profile?: LaunchBallProfile,
): void {
  const v0 = exitVeloMph * MPH_TO_FPS;
  const laRad = (launchAngleDeg * Math.PI) / 180;
  const sprayRad = (sprayAngleDeg * Math.PI) / 180;

  const baseHoriz = v0 * Math.cos(laRad);
  const baseVert = v0 * Math.sin(laRad);
  const { vHoriz, vVert } = calibrateLaunch(baseHoriz, baseVert, profile);

  // Engine coords: +x = right (toward 1B), +y = toward CF, z = altitude
  const vx = vHoriz * Math.sin(sprayRad);   // lateral component
  const vy = vHoriz * Math.cos(sprayRad);   // toward CF component
  const vz = vVert;                         // altitude component

  ball.pos = { x: 0, y: 0, z: CONTACT_HEIGHT_FT };  // bat height at home plate
  ball.state = { type: 'in-flight', vel: { x: vx, y: vy, z: vz } };
  ball.bounceCount = 0;  // fresh hit — hasn't touched the ground yet
}

/**
 * Advance the ball one tick. Handles in-flight (3D drag + gravity),
 * landing detection, rolling, and stopping.
 */
export function tickBall(ball: BallEntity, dt: number): TickBallResult {
  const result: TickBallResult = { landed: false, stopped: false };

  if (ball.state.type === 'in-flight') {
    const vel = ball.state.vel;
    const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);

    if (speed > 0.1) {
      // Drag: opposes velocity, proportional to v²
      const dragMag = K_DRAG * speed * speed;
      const ax = -(dragMag * vel.x) / speed;
      const ay = -(dragMag * vel.y) / speed;
      const az = -(dragMag * vel.z) / speed - G;  // gravity always pulls down

      vel.x += ax * dt;
      vel.y += ay * dt;
      vel.z += az * dt;
    } else {
      vel.z -= G * dt;
    }

    const prevPos = { x: ball.pos.x, y: ball.pos.y };
    ball.pos.x += vel.x * dt;
    ball.pos.y += vel.y * dt;
    ball.pos.z += vel.z * dt;

    // Wall collision: check if the ball crossed or passed a wall segment
    const wallHit = testWallCollision(ball.pos, prevPos, ball.pos.z);
    if (wallHit.hit) {
      if (wallHit.isHomeRun) {
        result.homeRun = true;
        result.wallHitPoint = wallHit.hitPoint;
        result.wallCrossHeightFt = ball.pos.z;
        // Ball keeps going (over the wall) — renderer can handle the visual
      } else if (wallHit.segment && wallHit.hitPoint) {
        // Ball bounces off the wall
        ball.pos.x = wallHit.hitPoint.x;
        ball.pos.y = wallHit.hitPoint.y;
        const reflected = reflectVelocity(
          { x: vel.x, y: vel.y },
          wallHit.segment.normal,
          0.35,
        );
        vel.x = reflected.x;
        vel.y = reflected.y;
        vel.z *= 0.5;  // lose vertical energy on wall hit
        result.wallBounce = true;
        result.wallHitPoint = wallHit.hitPoint;
      }
    }

    // Landing detection
    if (ball.pos.z <= 0) {
      ball.pos.z = 0;
      ball.bounceCount = (ball.bounceCount ?? 0) + 1;  // track ground contacts
      result.landed = true;
      result.landingPoint = { x: ball.pos.x, y: ball.pos.y };

      // Transition to rolling: bounce with energy loss.
      // Ground absorption: harder impacts lose more energy. The ground
      // exerts an equal-and-opposite force on impact — a ball driven
      // into the dirt at high speed transfers much more energy into the
      // surface than a soft landing.
      const impactVert = Math.abs(vel.z);  // downward speed at impact (ft/s)
      const horizSpeed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);

      // Impact absorption: scale from gentle (retain 75%) to violent (retain 15%)
      // impactFrac ∈ [0, 1]: 0 = soft landing, 1 = driven into dirt
      const impactFrac = Math.min(1, impactVert / 60);  // 60 fps ≈ max grounder impact

      // Vertical restitution: soft = 0.35, hard = 0.20 (dirt absorbs more)
      const vertRestitution = 0.35 - 0.15 * impactFrac;
      // Horizontal retention: soft = 0.75, hard = 0.35 (ground friction spike)
      const horizRetention = 0.75 - 0.40 * impactFrac;

      // Surface matters: dirt absorbs ~15% more than grass on hard hits
      const onDirt = isOnDirt(ball.pos);
      const surfacePenalty = onDirt ? 0.85 : 1.0;

      if (impactVert > 3 && horizSpeed > 5) {
        // Significant bounce — ball hops back up briefly
        vel.z = -vel.z * vertRestitution * surfacePenalty;
        vel.x *= horizRetention * surfacePenalty;
        vel.y *= horizRetention * surfacePenalty;
        ball.pos.z = 0.1;  // tiny lift to stay in flight one more tick
      } else {
        // Low energy — transition to ground roll
        const rollRetention = horizRetention * surfacePenalty;
        ball.state = {
          type: 'rolling',
          vel: { x: vel.x * rollRetention, y: vel.y * rollRetention },
        };
      }
    }
  } else if (ball.state.type === 'rolling') {
    const vel = ball.state.vel;
    const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);

    if (speed < 1) {
      // Ball has stopped
      ball.state = { type: 'idle' };
      result.stopped = true;
    } else {
      // Surface-aware friction: dirt has less friction than grass
      const decel = Math.min(surfaceDecel(ball.pos) * dt, speed);
      const factor = (speed - decel) / speed;
      vel.x *= factor;
      vel.y *= factor;
      const prevPos = { x: ball.pos.x, y: ball.pos.y };
      ball.pos.x += vel.x * dt;
      ball.pos.y += vel.y * dt;

      // Wall collision for rolling balls too
      const wallHit = testWallCollision(ball.pos, prevPos, 0);
      if (wallHit.hit && !wallHit.isHomeRun && wallHit.segment && wallHit.hitPoint) {
        ball.pos.x = wallHit.hitPoint.x;
        ball.pos.y = wallHit.hitPoint.y;
        const reflected = reflectVelocity(vel, wallHit.segment.normal, 0.25);
        vel.x = reflected.x;
        vel.y = reflected.y;
      }
    }
  } else if (ball.state.type === 'thrown') {
    const vel = ball.state.vel;
    const speed = Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z);

    // Light drag on throws
    if (speed > 0.1) {
      const dragMag = K_DRAG * speed * speed * 0.5;  // throws have less drag (spin)
      vel.x -= (dragMag * vel.x) / speed * dt;
      vel.y -= (dragMag * vel.y) / speed * dt;
      vel.z -= (dragMag * vel.z / speed + G) * dt;
    }

    ball.pos.x += vel.x * dt;
    ball.pos.y += vel.y * dt;
    ball.pos.z += vel.z * dt;

    const target = ball.state.target;
    const distToTarget = Math.hypot(ball.pos.x - target.x, ball.pos.y - target.y);

    // When the ball is near the target and at a catchable height, snap to
    // a receivable position so the covering fielder's collider catches it.
    // Don't assign 'held' here — let fielderAI.ts handle who receives it.
    if (distToTarget < 10 && ball.pos.z <= 5) {
      // Clamp height to chest level so the covering fielder can grab it
      ball.pos.z = Math.max(3, ball.pos.z);
      // Slow the ball dramatically — it's "arriving" at the receiver
      vel.x *= 0.3;
      vel.y *= 0.3;
      vel.z = 0;
    }

    // Only bounce to rolling if the ball is NOT near any target
    // (i.e., a truly wild throw that sailed past everyone)
    if (ball.pos.z <= 0) {
      ball.pos.z = 0;
      if (distToTarget > 15) {
        // Wild throw — no one nearby, becomes rolling
        ball.state = { type: 'rolling', vel: { x: vel.x * 0.5, y: vel.y * 0.5 } };
      } else {
        // Near the target — held by the intended receiver
        // The covering fielder will pick it up via their collider on the next tick
        ball.pos.z = 1;
        vel.x *= 0.2;
        vel.y *= 0.2;
        vel.z = 0;
      }
    }
  }

  return result;
}

export interface TickBallResult {
  landed: boolean;
  stopped: boolean;
  landingPoint?: Point2D;
  caught?: boolean;
  homeRun?: boolean;
  wallBounce?: boolean;
  wallHitPoint?: Point2D;
  wallCrossHeightFt?: number;
}
/**
 * Deterministic noise in [-1, 1] range. Uses a simple hash of the
 * input values so the same throw always produces the same scatter.
 * NOT crypto-quality — just needs to be consistent and spread well.
 */
function deterministicNoise(a: number, b: number, c: number, d: number): number {
  // Simple integer hash mixing
  let h = ((a * 73856093) ^ (b * 19349663) ^ (c * 83492791) ^ (d * 48611953)) | 0;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = ((h >> 16) ^ h) * 0x45d9f3b;
  h = (h >> 16) ^ h;
  // Map to [-1, 1]
  return ((h & 0xFFFF) / 0x7FFF) - 1;
}

/**
 * Initiate a throw from a fielder to a target point.
 *
 * Throw accuracy is skill-dependent:
 *   - TH (throwing skill) is the primary accuracy factor
 *   - AG (agility) affects release consistency
 *   - Distance scales scatter (longer throws are harder)
 *
 * All scatter is deterministic — derived from throw parameters,
 * not Math.random() — so replays are identical.
 */
export function throwBall(
  ball: BallEntity,
  from: Point2D,
  to: Point2D,
  throwVeloFps: number,
  thrower: string,
  throwingSkill: number = 5,
  agility: number = 5,
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist < 1) {
    // Trivial throw (at same location) — just hold
    ball.pos = { x: from.x, y: from.y, z: 5 };
    ball.state = { type: 'held', by: thrower };
    return;
  }

  // ─── Throw scatter ─────────────────────────────────────────────
  // TH skill controls base accuracy. AG affects consistency.
  // Scatter scales with distance (longer = harder to control).
  const th = Math.max(1, Math.min(10, throwingSkill));
  const ag = Math.max(1, Math.min(10, agility));

  // Base scatter at 100 ft:
  //   TH 10 = ±0.5 ft (laser arm)
  //   TH  5 = ±2.5 ft (average)
  //   TH  1 = ±5.0 ft (weak arm)
  const baseScatterPer100 = 5.5 - th * 0.5;
  // AG consistency: low AG adds random extra scatter
  const agPenalty = Math.max(0, (5 - ag) * 0.3);
  const scatterMag = (baseScatterPer100 + agPenalty) * (dist / 100);

  // Deterministic noise — same throw always gets same scatter
  const noiseX = deterministicNoise(
    Math.round(from.x * 10), Math.round(from.y * 10),
    Math.round(to.x * 10), Math.round(to.y * 10),
  );
  const noiseY = deterministicNoise(
    Math.round(to.x * 10), Math.round(from.y * 10),
    Math.round(from.x * 10), Math.round(to.y * 10),
  );

  // Apply scatter perpendicular to the throw line (more realistic
  // than scattering in x/y — a wild throw drifts left/right of the
  // line, not randomly in field space)
  const unitX = dx / dist;
  const unitY = dy / dist;
  // Perpendicular direction (rotate 90°)
  const perpX = -unitY;
  const perpY = unitX;
  // Lateral scatter (perpendicular to throw line)
  const lateralScatter = noiseX * scatterMag;
  // Along-line scatter (short/long, smaller magnitude)
  const lineScatter = noiseY * scatterMag * 0.3;

  const actualTargetX = to.x + perpX * lateralScatter + unitX * lineScatter;
  const actualTargetY = to.y + perpY * lateralScatter + unitY * lineScatter;

  const actualDx = actualTargetX - from.x;
  const actualDy = actualTargetY - from.y;
  const actualDist = Math.hypot(actualDx, actualDy);

  const flightTime = actualDist / throwVeloFps;

  // Calculate launch angle for the throw to arrive at ~3 ft height
  const vHoriz = actualDist / flightTime;
  // Solve for vz so ball arrives at z=3 after flightTime:
  //   3 = 5 + vz*t - 0.5*g*t²  →  vz = (3 - 5 + 0.5*g*t²) / t
  //   Simplified: vz = 0.5*g*t (for arrival at same height)
  const vz = 0.5 * G * flightTime;

  const aUnitX = actualDx / actualDist;
  const aUnitY = actualDy / actualDist;

  ball.pos = { x: from.x, y: from.y, z: 5 };  // release height
  ball.state = {
    type: 'thrown',
    vel: { x: vHoriz * aUnitX, y: vHoriz * aUnitY, z: vz },
    target: to,  // keep original target for receiver positioning
    thrower,
  };
}
