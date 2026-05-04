/**
 * Per-tick fielder AI — decides where each fielder should go and
 * transitions state machines based on ball/game state.
 *
 * This replaces the pre-computed coverage/converge system. Each tick,
 * every fielder evaluates the current situation and moves accordingly.
 */
import type { BallEntity, FielderEntity, Point2D } from './entities';
import { FIELDER_POSITIONS_FT } from '@baseballczar/sim-engine';
import type { Position } from '@baseballczar/sim-engine';
import { throwBall } from './ballPhysics';
import { COLLIDERS, dist2D, clampInsideWall } from './spatial';

// ─── Movement ────────────────────────────────────────────────────

/** Move a fielder toward a target point at their speed. Returns true
 *  if the fielder has arrived (within 2 ft).
 *  Automatically clamps position to stay inside the outfield wall. */
export function moveToward(
  fielder: FielderEntity,
  target: Point2D,
  dt: number,
  speedOverride?: number,
): boolean {
  const dx = target.x - fielder.pos.x;
  const dy = target.y - fielder.pos.y;
  const dist = Math.hypot(dx, dy);

  if (dist < 2) {
    fielder.pos.x = target.x;
    fielder.pos.y = target.y;
    // Clamp even at arrival — target itself may be past the wall
    clampInsideWall(fielder.pos);
    return true;
  }

  const speed = speedOverride ?? fielder.speedFps;
  const move = Math.min(speed * dt, dist);
  fielder.pos.x += (dx / dist) * move;
  fielder.pos.y += (dy / dist) * move;

  // Prevent running through the outfield wall
  clampInsideWall(fielder.pos);

  return dist - move < 2;
}

// ─── Spatial queries ─────────────────────────────────────────────

/** Distance from a fielder to a 2D point. */
function distTo(f: FielderEntity, pt: Point2D): number {
  return dist2D(f.pos, pt);
}

/** Find the closest fielder to a point (by position type filter). */
export function closestFielder(
  fielders: FielderEntity[],
  pt: Point2D,
  filter?: Position[],
): FielderEntity | undefined {
  let best: FielderEntity | undefined;
  let bestDist = Infinity;
  for (const f of fielders) {
    if (filter && !filter.includes(f.position)) continue;
    const d = distTo(f, pt);
    if (d < bestDist) {
      bestDist = d;
      best = f;
    }
  }
  return best;
}

// ─── Predicted landing ──────────────────────────────────────────

/** Predict where a ball in flight will land (simple parabolic). */
export function predictLanding(ball: BallEntity): Point2D | null {
  if (ball.state.type !== 'in-flight') return null;
  const vel = ball.state.vel;
  const vz = vel.z;
  const z = ball.pos.z;
  // Time to ground: z + vz*t - 0.5*g*t² = 0
  const g = 32.174;
  const disc = vz * vz + 2 * g * z;
  if (disc < 0) return null;
  const tLand = (vz + Math.sqrt(disc)) / g;
  // Horizontal position at landing (ignoring drag for prediction)
  return {
    x: ball.pos.x + vel.x * tLand,
    y: ball.pos.y + vel.y * tLand,
  };
}

// ─── Assignment ──────────────────────────────────────────────────

/** Assign fielder roles after contact. Called once per batted ball. */
export function assignFielderRoles(
  fielders: FielderEntity[],
  ball: BallEntity,
  predictedLanding: Point2D,
): void {
  // Find the closest fielder to the predicted landing
  const primary = closestFielder(fielders, predictedLanding);
  if (!primary) return;

  // The primary fielder tracks the ball
  primary.state = { type: 'tracking', target: predictedLanding };

  // Determine the throw target base (simplified: always second for now)
  const targetBase: Point2D = { x: 0, y: 127 };  // second base

  // Assign other fielders
  for (const f of fielders) {
    if (f === primary) continue;

    const isOF = ['LF', 'CF', 'RF'].includes(f.position);
    const isIF = ['B1', 'B2', 'SS', 'B3'].includes(f.position);

    if (f.position === 'P') {
      // Pitcher backs up the throw
      f.state = { type: 'backing-up', target: { x: 0, y: 75 } };
    } else if (f.position === 'C') {
      // Catcher stays home
      f.state = { type: 'covering', base: { x: 0, y: 0 } };
    } else if (isOF && f.position !== primary.position) {
      // Other outfielders back up
      const backupPt: Point2D = {
        x: (f.homePos.x + predictedLanding.x) / 2,
        y: (f.homePos.y + predictedLanding.y) / 2,
      };
      f.state = { type: 'backing-up', target: backupPt };
    } else if (isIF) {
      // Infielders cover bases or cut off
      const bases: Record<string, Point2D> = {
        first: { x: 64, y: 64 },
        second: { x: 0, y: 127 },
        third: { x: -64, y: 64 },
      };
      // Simple assignment: SS/B2 cover second, B1 covers first, B3 covers third
      if (f.position === 'B1') {
        f.state = { type: 'covering', base: bases.first };
      } else if (f.position === 'B3') {
        f.state = { type: 'covering', base: bases.third };
      } else {
        // SS or B2: one covers second, one cuts off
        // Cutoff: position on the line between fielder and target base
        const cutPt: Point2D = {
          x: (predictedLanding.x + targetBase.x) / 2,
          y: (predictedLanding.y + targetBase.y) / 2,
        };
        if (f.position === 'SS') {
          f.state = { type: 'cutting', relayPoint: cutPt };
        } else {
          f.state = { type: 'covering', base: bases.second };
        }
      }
    }
  }
}

// ─── Per-tick update ─────────────────────────────────────────────

/** Update a single fielder for one tick. */
export function tickFielder(
  fielder: FielderEntity,
  ball: BallEntity,
  dt: number,
): TickFielderResult {
  const result: TickFielderResult = {};

  switch (fielder.state.type) {
    case 'idle': {
      // Drift back to home if not there
      moveToward(fielder, fielder.homePos, dt, fielder.speedFps * 0.4);
      break;
    }

    case 'tracking': {
      // Sprint toward predicted landing / ball
      // Update prediction each tick for more realistic tracking
      const target = fielder.state.target;
      const arrived = moveToward(fielder, target, dt);

      // Check if we can catch the ball (collider-based)
      if (ball.state.type === 'in-flight') {
        const distToBall = dist2D(fielder.pos, ball.pos);
        const ballInRange = distToBall < COLLIDERS.catchStanding && ball.pos.z < 12 && ball.pos.z > 0;
        if (ballInRange) {
          // Caught it!
          ball.state = { type: 'held', by: fielder.position };
          fielder.state = { type: 'has-ball', decideSec: 0.4 };
          result.caught = true;
          result.event = { type: 'ball-caught', by: fielder.position, at: { ...fielder.pos } };
        }
      }

      // If ball landed and is rolling, switch to chasing
      if (ball.state.type === 'rolling' || ball.state.type === 'idle') {
        fielder.state = { type: 'chasing', target: { x: ball.pos.x, y: ball.pos.y } };
      }
      break;
    }

    case 'chasing': {
      // Update chase target to ball's current position
      if (ball.state.type === 'rolling') {
        fielder.state.target = { x: ball.pos.x, y: ball.pos.y };
      }
      const arrived = moveToward(fielder, fielder.state.target, dt);

      // Check if close enough to pick up (collider-based)
      const distToBall = dist2D(fielder.pos, ball.pos);
      if (distToBall < COLLIDERS.fieldGrounder && ball.pos.z < 3 &&
          (ball.state.type === 'rolling' || ball.state.type === 'idle')) {
        ball.state = { type: 'held', by: fielder.position };
        fielder.state = { type: 'has-ball', decideSec: 0.5 };
        result.fielded = true;
        result.event = { type: 'ball-fielded', by: fielder.position, at: { ...fielder.pos } };
      }
      break;
    }

    case 'has-ball': {
      // Decide where to throw (countdown)
      fielder.state.decideSec -= dt;
      if (fielder.state.decideSec <= 0) {
        // Default: throw to second base (simplified for Phase 1)
        const target: Point2D = { x: 0, y: 127 };
        fielder.state = { type: 'throwing', target, windupSec: 0.15 };
      }
      break;
    }

    case 'throwing': {
      fielder.state.windupSec -= dt;
      if (fielder.state.windupSec <= 0) {
        // Release the throw
        throwBall(ball, fielder.pos, fielder.state.target, fielder.throwVeloFps, fielder.position);
        result.threw = true;
        result.event = { type: 'throw-released', from: fielder.position, toBase: 'second' };
        fielder.state = { type: 'returning' };
      }
      break;
    }

    case 'covering': {
      moveToward(fielder, fielder.state.base, dt);
      // Check if a thrown ball arrives (collider-based)
      if (ball.state.type === 'thrown') {
        const distToBall = dist2D(fielder.pos, ball.pos);
        if (distToBall < COLLIDERS.receiveThrow && ball.pos.z < 8 && ball.pos.z > 0) {
          ball.state = { type: 'held', by: fielder.position };
          fielder.state = { type: 'has-ball', decideSec: 0.8 };
          result.event = { type: 'ball-received', by: fielder.position, at: { ...fielder.pos } };
        }
      }
      break;
    }

    case 'cutting': {
      moveToward(fielder, fielder.state.relayPoint, dt);
      // Cutoff man catches thrown ball if close (collider-based)
      if (ball.state.type === 'thrown') {
        const distToBall = dist2D(fielder.pos, ball.pos);
        if (distToBall < COLLIDERS.receiveThrow && ball.pos.z < 10 && ball.pos.z > 0) {
          ball.state = { type: 'held', by: fielder.position };
          fielder.state = { type: 'has-ball', decideSec: 0.3 };
          result.event = { type: 'ball-received', by: fielder.position, at: { ...fielder.pos } };
        }
      }
      break;
    }

    case 'backing-up': {
      moveToward(fielder, fielder.state.target, dt, fielder.speedFps * 0.7);
      break;
    }

    case 'returning': {
      const arrived = moveToward(fielder, fielder.homePos, dt, fielder.speedFps * 0.35);
      if (arrived) {
        fielder.state = { type: 'idle' };
      }
      break;
    }
  }

  return result;
}

export interface TickFielderResult {
  caught?: boolean;
  fielded?: boolean;
  threw?: boolean;
  event?: { type: string; by?: string; from?: string; at?: Point2D; toBase?: string };
}
