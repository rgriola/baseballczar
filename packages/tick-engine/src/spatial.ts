// Last touched by agent: 2026-05-05T06:10:00Z
/**
 * Spatial utilities — colliders, raycasts, wall geometry, and proximity queries.
 *
 * Every entity on the field has a collider radius. Interactions
 * (catch, tag, receive throw) are resolved via collision tests
 * rather than ad-hoc distance checks scattered through the AI.
 *
 * Raycasts let entities "look ahead" along a trajectory to predict
 * if the ball will pass through their reach zone, whether a throw
 * line is clear, etc.
 *
 * The outfield wall is modeled as an arc of line segments (5 control
 * points from the park CONFIG). Ball-wall collision detects when the
 * ball's ground projection crosses a wall segment and bounces it back.
 */
import type { Point2D, Point3D } from './entities';

// ─── Collider radii (feet) ───────────────────────────────────────

/** Fielder reach radii by interaction type. */
export const COLLIDERS = {
  /** Standing catch — glove extended, feet planted. */
  catchStanding: 6,
  /** Diving/leaping catch — fully extended body. */
  catchDiving: 10,
  /** Pick up a rolling/stopped ball on the ground. */
  fieldGrounder: 4,
  /** Receive a thrown ball (at a base, cutoff, etc.). */
  receiveThrow: 6,
  /** Tag a runner. */
  tagRunner: 4,
  /** Runner touching a base. */
  runnerOnBase: 3,
  /** Ball "close enough" to be considered at a target point. */
  ballAtTarget: 5,
  /** Ball radius (for ball-wall and ball-ground collision). */
  ballRadius: 0.12,  // ~1.45 inches = regulation baseball
  /** Fielder body radius for player-vs-player spacing. */
  fielderBody: 3.2,
  /** Runner body radius for player-vs-player spacing. */
  runnerBody: 2.8,
} as const;

export interface BodyCollider {
  pos: Point2D;
  radiusFt: number;
  lockPosition?: boolean;
}

/**
 * Resolve overlaps between circular body colliders in place.
 *
 * Use this after movement updates so entities maintain hard separation
 * in simulation space instead of only in the renderer.
 */
export function separateBodyColliders(
  colliders: BodyCollider[],
  iterations = 2,
): void {
  if (colliders.length < 2) return;

  for (let pass = 0; pass < iterations; pass++) {
    for (let i = 0; i < colliders.length; i++) {
      for (let j = i + 1; j < colliders.length; j++) {
        const a = colliders[i];
        const b = colliders[j];

        let dx = b.pos.x - a.pos.x;
        let dy = b.pos.y - a.pos.y;
        let dist = Math.hypot(dx, dy);
        const minDist = a.radiusFt + b.radiusFt;
        if (dist >= minDist) continue;

        if (dist < 1e-4) {
          dx = (j - i) % 2 === 0 ? 1 : -1;
          dy = 0;
          dist = 1;
        }

        const nx = dx / dist;
        const ny = dy / dist;
        const overlap = minDist - dist;
        const aLocked = Boolean(a.lockPosition);
        const bLocked = Boolean(b.lockPosition);

        if (aLocked && bLocked) continue;

        if (aLocked) {
          b.pos.x += nx * overlap;
          b.pos.y += ny * overlap;
          clampInsideWall(b.pos, DEFAULT_WALL, b.radiusFt);
          continue;
        }

        if (bLocked) {
          a.pos.x -= nx * overlap;
          a.pos.y -= ny * overlap;
          clampInsideWall(a.pos, DEFAULT_WALL, a.radiusFt);
          continue;
        }

        const push = overlap * 0.5;
        a.pos.x -= nx * push;
        a.pos.y -= ny * push;
        b.pos.x += nx * push;
        b.pos.y += ny * push;
        clampInsideWall(a.pos, DEFAULT_WALL, a.radiusFt);
        clampInsideWall(b.pos, DEFAULT_WALL, b.radiusFt);
      }
    }
  }
}

// ─── Circle collision ────────────────────────────────────────────

/** Test if two circles overlap (2D). */
export function circlesOverlap(
  a: Point2D, radiusA: number,
  b: Point2D, radiusB: number,
): boolean {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const rSum = radiusA + radiusB;
  return dx * dx + dy * dy <= rSum * rSum;
}

/** Distance between two 2D points. */
export function dist2D(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** Distance between two 3D points. */
export function dist3D(a: Point3D, b: Point3D): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

// ─── Raycast ─────────────────────────────────────────────────────

export interface RaycastHit {
  /** Parameter along the ray [0, 1] where the hit occurs. */
  t: number;
  /** Point of closest approach to the circle center. */
  point: Point2D;
  /** Distance from ray to circle center at closest approach. */
  distance: number;
}

/**
 * Cast a 2D ray from `origin` in direction `dir` (unit vector) and test
 * against a circle at `center` with `radius`.
 *
 * Returns the hit info if the ray intersects the circle, or null.
 * `maxDist` limits how far the ray travels (in feet).
 *
 * Use cases:
 * - Ball trajectory vs fielder reach zone (will the ball pass through?)
 * - Throw line vs fielder (can the cutoff man intercept?)
 * - Runner path vs tag zone
 */
export function raycastCircle(
  origin: Point2D,
  dir: Point2D,
  center: Point2D,
  radius: number,
  maxDist = 500,
): RaycastHit | null {
  // Vector from origin to circle center
  const ox = center.x - origin.x;
  const oy = center.y - origin.y;

  // Project onto ray direction
  const t = ox * dir.x + oy * dir.y;

  // Closest point on ray to circle center
  const closestX = origin.x + dir.x * t;
  const closestY = origin.y + dir.y * t;
  const dist = Math.hypot(closestX - center.x, closestY - center.y);

  if (t < 0 || t > maxDist || dist > radius) {
    return null;
  }

  return {
    t,
    point: { x: closestX, y: closestY },
    distance: dist,
  };
}

/**
 * Project a ball's trajectory forward and test against a fielder's
 * reach zone. Returns the time (in seconds) until the ball enters
 * the fielder's catch radius, or null if it won't.
 *
 * This is the key "can this fielder catch this ball?" check:
 * - Projects the ball's current velocity forward
 * - Tests against the fielder's standing catch radius
 * - Returns time-to-intersection so the AI can decide if it's
 *   worth attempting (compare against fielder's time-to-arrival)
 */
export function ballWillReachFielder(
  ballPos: Point2D,
  ballVel: Point2D,
  fielderPos: Point2D,
  catchRadius = COLLIDERS.catchStanding,
): { timeToReach: number; intersectPoint: Point2D } | null {
  const speed = Math.hypot(ballVel.x, ballVel.y);
  if (speed < 1) return null;

  const dir: Point2D = { x: ballVel.x / speed, y: ballVel.y / speed };
  const hit = raycastCircle(ballPos, dir, fielderPos, catchRadius, speed * 10);
  if (!hit) return null;

  return {
    timeToReach: hit.t / speed,
    intersectPoint: hit.point,
  };
}

/**
 * Test if a point is inside a base's tag zone.
 * Used for force outs and tag plays.
 */
export function isAtBase(pos: Point2D, basePos: Point2D): boolean {
  return dist2D(pos, basePos) <= COLLIDERS.runnerOnBase;
}

/**
 * Find all entities within a radius of a point.
 * Generic spatial query used throughout the AI.
 */
export function entitiesInRadius<T extends { pos: Point2D }>(
  entities: T[],
  center: Point2D,
  radius: number,
): T[] {
  return entities.filter(e => dist2D(e.pos, center) <= radius);
}

// ─── Outfield wall geometry ──────────────────────────────────────
// The wall is an arc of line segments built from 5 control points
// at the CONFIG park dimensions. Each point is computed from the
// distance along its spray angle from home plate.

export interface WallSegment {
  a: Point2D;
  b: Point2D;
  /** Wall height in feet at this segment. */
  heightFt: number;
  /** Outward-facing normal (points toward the field). */
  normal: Point2D;
}

/** Park dimensions → wall segments. Called once at init. */
export function buildWallSegments(park: {
  leftLineFt: number;
  leftCenterFt: number;
  centerFt: number;
  rightCenterFt: number;
  rightLineFt: number;
  wallHeightFt: number;
}): WallSegment[] {
  // 5 control points: LF line, LCF, CF, RCF, RF line.
  // Angles are from home plate (0° = straight CF):
  //   LF line ≈ -45°, LCF ≈ -22.5°, CF = 0°, RCF ≈ +22.5°, RF ≈ +45°
  const angles = [-45, -22.5, 0, 22.5, 45];
  const dists = [
    park.leftLineFt,
    park.leftCenterFt,
    park.centerFt,
    park.rightCenterFt,
    park.rightLineFt,
  ];

  const points: Point2D[] = angles.map((deg, i) => {
    const rad = (deg * Math.PI) / 180;
    return {
      x: dists[i] * Math.sin(rad),
      y: dists[i] * Math.cos(rad),
    };
  });

  const segments: WallSegment[] = [];
  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];
    // Normal pointing inward (toward home plate)
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    // Perpendicular: rotate 90° clockwise, then check it points toward home
    let nx = dy / len;
    let ny = -dx / len;
    // If normal points away from home (dot with midpoint→home is negative), flip
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    if (nx * (-mx) + ny * (-my) < 0) {
      nx = -nx;
      ny = -ny;
    }
    segments.push({ a, b, heightFt: park.wallHeightFt, normal: { x: nx, y: ny } });
  }

  return segments;
}

/** Default wall built from CONFIG park dimensions. */
export const DEFAULT_WALL = buildWallSegments({
  leftLineFt: 320,
  leftCenterFt: 375,
  centerFt: 405,
  rightCenterFt: 375,
  rightLineFt: 320,
  wallHeightFt: 10,
});

export interface WallCollisionResult {
  /** Did the ball hit a wall segment? */
  hit: boolean;
  /** The segment that was hit. */
  segment?: WallSegment;
  /** The point on the wall where the ball hit. */
  hitPoint?: Point2D;
  /** Is the ball over the wall (home run)? */
  isHomeRun: boolean;
}

/**
 * Test if a ball at `pos` with velocity `vel` has crossed or will cross
 * a wall segment this tick. If the ball's altitude (z) exceeds the wall
 * height, it's a home run. Otherwise it bounces off.
 */
export function testWallCollision(
  pos: Point2D,
  prevPos: Point2D,
  ballZ: number,
  walls: WallSegment[] = DEFAULT_WALL,
): WallCollisionResult {
  for (const seg of walls) {
    // Ray-segment intersection: does the line prevPos→pos cross seg.a→seg.b?
    const hit = lineSegmentIntersection(prevPos, pos, seg.a, seg.b);
    if (hit) {
      // Check if ball is above the wall height → HR
      if (ballZ > seg.heightFt) {
        return { hit: true, segment: seg, hitPoint: hit, isHomeRun: true };
      }
      return { hit: true, segment: seg, hitPoint: hit, isHomeRun: false };
    }

    // Also check if ball is past the wall (distance from home > wall distance)
    const ballDist = Math.hypot(pos.x, pos.y);
    const wallMidDist = Math.hypot(
      (seg.a.x + seg.b.x) / 2,
      (seg.a.y + seg.b.y) / 2,
    );
    if (ballDist > wallMidDist + 5) {
      // Ball is past this wall section
      const closestOnSeg = closestPointOnSegment(pos, seg.a, seg.b);
      const distToSeg = dist2D(pos, closestOnSeg);
      if (distToSeg < 20) {
        if (ballZ > seg.heightFt) {
          return { hit: true, segment: seg, hitPoint: closestOnSeg, isHomeRun: true };
        }
        return { hit: true, segment: seg, hitPoint: closestOnSeg, isHomeRun: false };
      }
    }
  }
  return { hit: false, isHomeRun: false };
}

/**
 * Reflect a 2D velocity off a wall normal (elastic bounce with restitution).
 */
export function reflectVelocity(
  vel: Point2D,
  normal: Point2D,
  restitution = 0.35,
): Point2D {
  const dot = vel.x * normal.x + vel.y * normal.y;
  return {
    x: (vel.x - 2 * dot * normal.x) * restitution,
    y: (vel.y - 2 * dot * normal.y) * restitution,
  };
}

// ─── Line segment math ──────────────────────────────────────────

/** Intersection point of two line segments, or null. */
function lineSegmentIntersection(
  p1: Point2D, p2: Point2D,
  p3: Point2D, p4: Point2D,
): Point2D | null {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const cross = d1x * d2y - d1y * d2x;
  if (Math.abs(cross) < 1e-10) return null;  // parallel

  const t = ((p3.x - p1.x) * d2y - (p3.y - p1.y) * d2x) / cross;
  const u = ((p3.x - p1.x) * d1y - (p3.y - p1.y) * d1x) / cross;

  if (t >= 0 && t <= 1 && u >= 0 && u <= 1) {
    return { x: p1.x + t * d1x, y: p1.y + t * d1y };
  }
  return null;
}

/** Closest point on a line segment to a given point. */
function closestPointOnSegment(
  p: Point2D, a: Point2D, b: Point2D,
): Point2D {
  const dx = b.x - a.x, dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq < 1e-10) return { ...a };
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq));
  return { x: a.x + t * dx, y: a.y + t * dy };
}

// ─── Foul lines ──────────────────────────────────────────────────

/** Check if a 2D point is in fair territory (between the foul lines).
 *  Foul lines extend from home plate at ±45°. */
export function isInFairTerritory(pos: Point2D): boolean {
  if (pos.y < 0) return false;  // behind home plate
  // Fair territory: |spray angle| <= 45°
  // spray angle = atan2(x, y) in engine coords
  const angle = Math.abs(Math.atan2(pos.x, pos.y)) * (180 / Math.PI);
  return angle <= 45;
}

// ─── Entity wall clamping ────────────────────────────────────────

/**
 * Prevent a position from going past the outfield wall.
 *
 * For each wall segment, checks if the point is "outside" (past the
 * wall in the outward direction). If so, pushes the point back to
 * the wall surface minus a buffer so entities stay on the playing field.
 *
 * @param pos - The entity position (mutated in place if clamped).
 * @param bufferFt - How far inside the wall to stop (default 3ft — body radius).
 * @returns true if the position was clamped.
 */
export function clampInsideWall(
  pos: Point2D,
  walls: WallSegment[] = DEFAULT_WALL,
  bufferFt = 3,
): boolean {
  const homeDist = Math.hypot(pos.x, pos.y);
  // Only check for outfield-depth positions (skip infielders at < 100ft)
  if (homeDist < 100) return false;

  let clamped = false;

  for (const seg of walls) {
    // Find closest point on this wall segment to the entity
    const closest = closestPointOnSegment(pos, seg.a, seg.b);
    const toPos = { x: pos.x - closest.x, y: pos.y - closest.y };

    // Dot with the inward normal — positive means the point is ON the field side
    const dot = toPos.x * seg.normal.x + toPos.y * seg.normal.y;

    if (dot < 0) {
      // The entity is PAST the wall (on the outside)
      // Push back to the wall minus buffer
      pos.x = closest.x + seg.normal.x * bufferFt;
      pos.y = closest.y + seg.normal.y * bufferFt;
      clamped = true;
    } else if (dot < bufferFt) {
      // Too close to the wall — nudge inward to the buffer line
      const deficit = bufferFt - dot;
      pos.x += seg.normal.x * deficit;
      pos.y += seg.normal.y * deficit;
      clamped = true;
    }
  }

  return clamped;
}
