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
export function launchBall(
  ball: BallEntity,
  exitVeloMph: number,
  launchAngleDeg: number,
  sprayAngleDeg: number,
): void {
  const v0 = exitVeloMph * MPH_TO_FPS;
  const laRad = (launchAngleDeg * Math.PI) / 180;
  const sprayRad = (sprayAngleDeg * Math.PI) / 180;

  const vHoriz = v0 * Math.cos(laRad);
  const vVert = v0 * Math.sin(laRad);

  // Engine coords: +x = right (toward 1B), +y = toward CF, z = altitude
  const vx = vHoriz * Math.sin(sprayRad);   // lateral component
  const vy = vHoriz * Math.cos(sprayRad);   // toward CF component
  const vz = vVert;                         // altitude component

  ball.pos = { x: 0, y: 0, z: 3 };  // bat height at home plate
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

      // Transition to rolling: bounce with energy loss
      const horizSpeed = Math.sqrt(vel.x * vel.x + vel.y * vel.y);
      if (Math.abs(vel.z) > 3 && horizSpeed > 5) {
        // Significant bounce — ball hops back up briefly
        vel.z = -vel.z * BOUNCE_RESTITUTION;
        vel.x *= HORIZ_BOUNCE;
        vel.y *= HORIZ_BOUNCE;
        ball.pos.z = 0.1;  // tiny lift to stay in flight one more tick
      } else {
        // Low energy — transition to ground roll
        ball.state = {
          type: 'rolling',
          vel: { x: vel.x * HORIZ_BOUNCE, y: vel.y * HORIZ_BOUNCE },
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
