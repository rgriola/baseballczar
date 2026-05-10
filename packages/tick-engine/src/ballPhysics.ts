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
  // the dirt. We should NOT try to calibrate vertical velocity to
  // match hang time — that makes it dive into the ground at extreme
  // speed. Instead, use a gentle downward angle and calibrate only
  // the horizontal speed to match the target distance.
  if (baseVert <= 0) {
    // Grounder: small downward vVert (just enough to hit dirt from bat
    // height in ~0.2-0.3s). The bounce + roll physics in tickBall
    // handles the rest naturally.
    const gentleVert = -G * 0.15;  // lands in ~0.3s from 3ft → realistic dirt hit
    // Horizontal: aim for target distance / target time
    // (grounder travels at roughly constant speed with friction)
    const vHoriz = Math.max(10, targetDistanceFt / Math.max(0.3, targetHangTimeSec));
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

    // Catch height: ~3-5 ft
    if (ball.pos.z <= 3) {
      const target = ball.state.target;
      const distToTarget = Math.hypot(ball.pos.x - target.x, ball.pos.y - target.y);
      if (distToTarget < 8) {
        // Close enough to receiver — they catch it
        ball.pos.z = 3;
        ball.state = { type: 'held', by: ball.state.thrower };
        result.caught = true;
      }
    }
    if (ball.pos.z <= 0) {
      ball.pos.z = 0;
      ball.state = { type: 'rolling', vel: { x: vel.x * 0.5, y: vel.y * 0.5 } };
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
 * Initiate a throw from a fielder to a target point.
 */
export function throwBall(
  ball: BallEntity,
  from: Point2D,
  to: Point2D,
  throwVeloFps: number,
  thrower: string,
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  const flightTime = dist / throwVeloFps;

  // Calculate launch angle for the throw to arrive at ~3 ft height
  const vHoriz = dist / flightTime;
  // Solve for vz so ball arrives at z=3 after flightTime:
  //   3 = 3 + vz*t - 0.5*g*t²  →  vz = 0.5*g*t
  const vz = 0.5 * G * flightTime;

  const unitX = dx / dist;
  const unitY = dy / dist;

  ball.pos = { x: from.x, y: from.y, z: 5 };  // release height
  ball.state = {
    type: 'thrown',
    vel: { x: vHoriz * unitX, y: vHoriz * unitY, z: vz },
    target: to,
    thrower,
  };
}
