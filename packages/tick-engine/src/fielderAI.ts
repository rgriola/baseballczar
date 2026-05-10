// Last touched by agent: 2026-05-05T06:39:42Z
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
import { getBaseAnchor, getFielderCoverPoint } from './fieldGeometry';

// ─── PI-based helpers ────────────────────────────────────────────

/** Route efficiency: low PI → indirect routes (1.0-1.15x distance).
 *  High PI → direct route (1.0x). This scales the effective distance. */
function routeEfficiency(pi: number): number {
  return 1.0 + (10 - Math.min(10, Math.max(1, pi))) * 0.0167;
}

/** Decision time: how long a fielder holds the ball before throwing.
 *  High PI → quick decisions, low PI → hesitation. */
function decisionTimeSec(pi: number): number {
  return 0.60 - (Math.min(10, Math.max(1, pi)) - 1) * 0.044;
}

// ─── Movement ────────────────────────────────────────────────────

const BACKPEDAL_PENALTY = 0.5;
const BACKPEDAL_ANGLE_RAD = (120 * Math.PI) / 180;
const CATCH_FACING_TOLERANCE_RAD = (65 * Math.PI) / 180;
const FIELD_FACING_TOLERANCE_RAD = (70 * Math.PI) / 180;
const RECEIVE_FACING_TOLERANCE_RAD = (85 * Math.PI) / 180;
const THROW_FACING_TOLERANCE_RAD = (25 * Math.PI) / 180;
const SHORT_CONTACT_DEPTH_FT = 70;
const INFIELD_CONTACT_DEPTH_FT = 150;
const CORNER_SIDE_THRESHOLD_FT = 35;

function angleToPoint(from: Point2D, to: Point2D): number {
  return Math.atan2(-(to.y - from.y), to.x - from.x);
}

function normalizeAngle(rad: number): number {
  let out = rad;
  while (out <= -Math.PI) out += Math.PI * 2;
  while (out > Math.PI) out -= Math.PI * 2;
  return out;
}

function angleDelta(current: number, target: number): number {
  return normalizeAngle(target - current);
}

function rotateToward(current: number, target: number, maxStep: number): number {
  const delta = angleDelta(current, target);
  if (Math.abs(delta) <= maxStep) return target;
  return normalizeAngle(current + Math.sign(delta) * maxStep);
}

function isFacingPoint(fielder: FielderEntity, target: Point2D, toleranceRad: number): boolean {
  const desired = angleToPoint(fielder.pos, target);
  return Math.abs(angleDelta(fielder.facingRad, desired)) <= toleranceRad;
}

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

  const desiredFacing = angleToPoint(fielder.pos, target);
  fielder.facingRad = rotateToward(
    fielder.facingRad,
    desiredFacing,
    fielder.turnRateRad * dt,
  );

  const facingError = Math.abs(angleDelta(fielder.facingRad, desiredFacing));
  const speedPenalty = facingError > BACKPEDAL_ANGLE_RAD ? BACKPEDAL_PENALTY : 1;
  // Apply route efficiency penalty for low-PI fielders
  const efficiency = routeEfficiency(fielder.playIntelligence ?? 5);
  const speed = ((speedOverride ?? fielder.speedFps) * speedPenalty) / efficiency;
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
  const depthFt = Math.hypot(predictedLanding.x, predictedLanding.y);
  const isOutfieldBall = depthFt > INFIELD_CONTACT_DEPTH_FT;

  const primaryPool: Position[] = depthFt <= SHORT_CONTACT_DEPTH_FT
    ? ['P', 'C', 'B1', 'B2', 'SS', 'B3']
    : isOutfieldBall
      ? ['LF', 'CF', 'RF']
      : ['P', 'B1', 'B2', 'SS', 'B3'];

  // Pick primary from a realistic responsibility pool first.
  const primary = closestFielder(fielders, predictedLanding, primaryPool)
    ?? closestFielder(fielders, predictedLanding);
  if (!primary) return;

  // The primary fielder tracks the ball
  primary.state = { type: 'tracking', target: predictedLanding };

  const secondBase = getBaseAnchor('second');
  const cutoffPos: Position = predictedLanding.x < -CORNER_SIDE_THRESHOLD_FT
    ? 'SS'
    : predictedLanding.x > CORNER_SIDE_THRESHOLD_FT
      ? 'B2'
      : 'SS';
  const cutoffPt: Point2D = {
    x: (predictedLanding.x + secondBase.x) / 2,
    y: (predictedLanding.y + secondBase.y) / 2,
  };

  // Assign other fielders
  for (const f of fielders) {
    if (f === primary) continue;

    const isOF = ['LF', 'CF', 'RF'].includes(f.position);
    const isIF = ['B1', 'B2', 'SS', 'B3'].includes(f.position);

    if (f.position === 'P') {
      // Pitcher backs up infield plays near the mound, OF plays toward home.
      f.state = {
        type: 'backing-up',
        target: isOutfieldBall ? { x: 0, y: 90 } : { x: 0, y: 70 },
      };
    } else if (f.position === 'C') {
      // Catcher stays home; no deep-ball chasing except very short contact.
      f.state = { type: 'covering', base: getBaseAnchor('home') };
    } else if (isOF && f.position !== primary.position) {
      // Non-primary OF backs up to keep extra bases honest.
      const backupPt: Point2D = {
        x: (f.homePos.x + predictedLanding.x) / 2,
        y: (f.homePos.y + predictedLanding.y) / 2,
      };
      f.state = { type: 'backing-up', target: backupPt };
    } else if (isIF) {
      // Infield progression by contact depth:
      // - Infield ball: corners hold bags, MIF hold middle.
      // - Outfield ball: one MIF is cutoff, one covers second.
      if (f.position === 'B1') {
        f.state = { type: 'covering', base: getFielderCoverPoint('first', f.position) };
      } else if (f.position === 'B3') {
        f.state = { type: 'covering', base: getFielderCoverPoint('third', f.position) };
      } else if (f.position === 'B2' || f.position === 'SS') {
        if (isOutfieldBall && f.position === cutoffPos) {
          f.state = { type: 'cutting', relayPoint: cutoffPt };
        } else {
          f.state = { type: 'covering', base: getFielderCoverPoint('second', f.position) };
        }
      } else {
        f.state = { type: 'returning' };
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
        // PI affects glove radius — high PI fielders take better routes
        const catchRadius = COLLIDERS.catchStanding + ((fielder.playIntelligence ?? 5) - 5) * 0.3;
        const ballInRange =
          distToBall < catchRadius &&
          ball.pos.z < 12 &&
          ball.pos.z > 0 &&
          isFacingPoint(fielder, { x: ball.pos.x, y: ball.pos.y }, CATCH_FACING_TOLERANCE_RAD);
        if (ballInRange) {
          // Caught it!
          ball.state = { type: 'held', by: fielder.position };
          fielder.state = { type: 'has-ball', decideSec: decisionTimeSec(fielder.playIntelligence ?? 5) };
          result.caught = true;
          result.event = {
            type: 'ball-caught',
            by: fielder.position,
            playerId: fielder.playerId > 0 ? fielder.playerId : undefined,
            at: { ...fielder.pos },
          };
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
          (ball.state.type === 'rolling' || ball.state.type === 'idle') &&
          isFacingPoint(fielder, { x: ball.pos.x, y: ball.pos.y }, FIELD_FACING_TOLERANCE_RAD)) {
        ball.state = { type: 'held', by: fielder.position };
        fielder.state = { type: 'has-ball', decideSec: decisionTimeSec(fielder.playIntelligence ?? 5) };
        result.fielded = true;
        result.event = {
          type: 'ball-fielded',
          by: fielder.position,
          playerId: fielder.playerId > 0 ? fielder.playerId : undefined,
          at: { ...fielder.pos },
        };
      }
      break;
    }

    case 'has-ball': {
      // Decide where to throw (countdown)
      fielder.state.decideSec -= dt;
      if (fielder.state.decideSec <= 0) {
        // Default: throw to second base (simplified for Phase 1)
        const target = getBaseAnchor('second');
        fielder.state = { type: 'throwing', target, windupSec: 0.15 };
      }
      break;
    }

    case 'throwing': {
      const desiredFacing = angleToPoint(fielder.pos, fielder.state.target);
      fielder.facingRad = rotateToward(
        fielder.facingRad,
        desiredFacing,
        fielder.turnRateRad * dt,
      );
      if (Math.abs(angleDelta(fielder.facingRad, desiredFacing)) > THROW_FACING_TOLERANCE_RAD) {
        break;
      }

      fielder.state.windupSec -= dt;
      if (fielder.state.windupSec <= 0) {
        // Release the throw
        throwBall(ball, fielder.pos, fielder.state.target, fielder.throwVeloFps, fielder.position);
        result.threw = true;
        result.event = {
          type: 'throw-released',
          from: fielder.position,
          fromId: fielder.playerId > 0 ? fielder.playerId : undefined,
          toBase: 'second',
        };
        fielder.state = { type: 'returning' };
      }
      break;
    }

    case 'covering': {
      moveToward(fielder, fielder.state.base, dt);
      // Check if a thrown ball arrives (collider-based)
      if (ball.state.type === 'thrown') {
        const distToBall = dist2D(fielder.pos, ball.pos);
        if (distToBall < COLLIDERS.receiveThrow &&
            ball.pos.z < 8 &&
            ball.pos.z > 0 &&
            isFacingPoint(fielder, { x: ball.pos.x, y: ball.pos.y }, RECEIVE_FACING_TOLERANCE_RAD)) {
          ball.state = { type: 'held', by: fielder.position };
          fielder.state = { type: 'has-ball', decideSec: 0.8 };
          result.event = {
            type: 'ball-received',
            by: fielder.position,
            playerId: fielder.playerId > 0 ? fielder.playerId : undefined,
            at: { ...fielder.pos },
          };
        }
      }
      break;
    }

    case 'cutting': {
      moveToward(fielder, fielder.state.relayPoint, dt);
      // Cutoff man catches thrown ball if close (collider-based)
      if (ball.state.type === 'thrown') {
        const distToBall = dist2D(fielder.pos, ball.pos);
        if (distToBall < COLLIDERS.receiveThrow &&
            ball.pos.z < 10 &&
            ball.pos.z > 0 &&
            isFacingPoint(fielder, { x: ball.pos.x, y: ball.pos.y }, RECEIVE_FACING_TOLERANCE_RAD)) {
          ball.state = { type: 'held', by: fielder.position };
          fielder.state = { type: 'has-ball', decideSec: 0.3 };
          result.event = {
            type: 'ball-received',
            by: fielder.position,
            playerId: fielder.playerId > 0 ? fielder.playerId : undefined,
            at: { ...fielder.pos },
          };
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
  event?: {
    type: string;
    by?: string;
    playerId?: number;
    playerName?: string;
    from?: string;
    fromId?: number;
    fromName?: string;
    at?: Point2D;
    toBase?: string;
  };
}
