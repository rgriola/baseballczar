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

// ─── Glove / Fielding skill helpers ──────────────────────────────

/** Catch radius for fly balls. FLD is the dominant factor (glove reach
 *  + hand softness), PI adds a small bonus for route precision. */
function catchRadiusForSkills(defense: number, pi: number): number {
  const fld = Math.max(1, Math.min(10, defense));
  const piVal = Math.max(1, Math.min(10, pi));
  // Base: 6 ft. FLD adds ±2.5 ft (range: 3.5–8.5 ft).
  // PI adds ±0.6 ft (small: route precision, not reach).
  return COLLIDERS.catchStanding
    + (fld - 5) * 0.5     // FLD: dominant glove reach
    + (piVal - 5) * 0.12; // PI: minor route precision bonus
}

/** Field radius for grounders. FLD affects range and clean pickup. */
function fieldRadiusForSkills(defense: number): number {
  const fld = Math.max(1, Math.min(10, defense));
  // Base: 4 ft. FLD adds ±1.6 ft (range: 2.4–5.6 ft).
  return COLLIDERS.fieldGrounder + (fld - 5) * 0.4;
}

/** Transfer time: time from fielding/catching the ball to being ready
 *  to throw. Glove-to-hand transfer + body set.
 *  FLD = hand softness / clean exchange, AG = body quickness. */
function transferTimeSec(defense: number, ag: number): number {
  const fld = Math.max(1, Math.min(10, defense));
  const agVal = Math.max(1, Math.min(10, ag));
  // Base: 0.30s. FLD reduces by up to 0.16s, AG reduces by up to 0.12s.
  // FLD 10 + AG 10 = 0.02s (elite). FLD 1 + AG 1 = 0.58s (clumsy).
  return Math.max(0.02, 0.30 + (5 - fld) * 0.04 + (5 - agVal) * 0.03);
}

/** Windup time before throw release. Varies by position + AG.
 *  Catchers are slowest (crouch transfer), P is mid, IF are fastest. */
function windupTimeSec(position: string, ag: number): number {
  const agVal = Math.max(1, Math.min(10, ag));
  const baseByPos: Record<string, number> = {
    C: 0.28,   // longest — transfer from crouch
    P: 0.22,   // mid — mound mechanics
    B1: 0.16, B2: 0.14, SS: 0.14, B3: 0.16,  // infielders: quick
    LF: 0.20, CF: 0.18, RF: 0.20,             // outfielders: mid-quick
  };
  const base = baseByPos[position] ?? 0.18;
  const agBonus = (agVal - 5) * -0.012;  // high AG = faster release
  return Math.max(0.06, base + agBonus);
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
const INFIELD_OF_GRAY_ZONE_FT = 120;  // overlap zone where both IF/OF can field
const CORNER_SIDE_THRESHOLD_FT = 35;

/** PI-based reaction delay (seconds) before a fielder starts tracking.
 *  High PI = quick read, low PI = hesitation / bad first step. */
function reactionDelaySec(pi: number): number {
  const piVal = Math.max(1, Math.min(10, pi));
  // PI 10 = 0.10s (elite read), PI 5 = 0.28s, PI 1 = 0.45s
  return 0.48 - piVal * 0.038;
}

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

/** Find the closest fielder to a point (by position type filter).
 *  When `ballDir` is supplied, raw distance is adjusted by the approach
 *  angle: fielders the ball is heading TOWARD get a lower effective
 *  distance, while fielders the ball is moving AWAY from are penalized.
 *  This models the real-world advantage of converging on the ball vs
 *  having to chase it down from behind. */
export function closestFielder(
  fielders: FielderEntity[],
  pt: Point2D,
  filter?: Position[],
  ballDir?: Point2D,
): FielderEntity | undefined {
  // Normalized ball direction for approach-angle weighting
  let bdNorm: Point2D | null = null;
  if (ballDir) {
    const bdLen = Math.hypot(ballDir.x, ballDir.y);
    if (bdLen > 0.01) bdNorm = { x: ballDir.x / bdLen, y: ballDir.y / bdLen };
  }

  // Approach-angle weight: how much the effective distance shifts.
  // 0.30 = 30% bonus for head-on convergence, 30% penalty for chasing.
  const APPROACH_WEIGHT = 0.30;

  let best: FielderEntity | undefined;
  let bestDist = Infinity;
  for (const f of fielders) {
    if (filter && !filter.includes(f.position)) continue;
    const rawDist = distTo(f, pt);

    let effectiveDist = rawDist;
    if (bdNorm) {
      // Direction from ball origin toward this fielder
      const toFielder = { x: f.pos.x - pt.x, y: f.pos.y - pt.y };
      const tfLen = Math.hypot(toFielder.x, toFielder.y);
      if (tfLen > 0.01) {
        // dot ∈ [-1, 1]: +1 = ball heading straight at fielder, -1 = straight away
        const dot = (bdNorm.x * toFielder.x + bdNorm.y * toFielder.y) / tfLen;
        // factor: 0.70 (converging) .. 1.00 (perpendicular) .. 1.30 (chasing)
        effectiveDist = rawDist * (1 - APPROACH_WEIGHT * dot);
      }
    }

    if (effectiveDist < bestDist) {
      bestDist = effectiveDist;
      best = f;
    }
  }
  return best;
}

// ─── Predicted landing ──────────────────────────────────────────

/** Predict where a ball in flight will land.
 *  Uses forward Euler with the same drag model as ballPhysics.ts
 *  so fielders run to the RIGHT spot, not a drag-free overshoot. */
export function predictLanding(ball: BallEntity): Point2D | null {
  if (ball.state.type !== 'in-flight') return null;
  const G = 32.174;
  const K_DRAG = 0.00180;  // must match ballPhysics.ts
  const DT = 1 / 30;       // coarse step is fine for prediction

  let x = ball.pos.x, y = ball.pos.y, z = ball.pos.z;
  let vx = ball.state.vel.x, vy = ball.state.vel.y, vz = ball.state.vel.z;

  for (let t = 0; t < 12; t += DT) {
    const speed = Math.sqrt(vx * vx + vy * vy + vz * vz);
    if (speed > 0.1) {
      const dragMag = K_DRAG * speed * speed;
      vx -= (dragMag * vx / speed) * DT;
      vy -= (dragMag * vy / speed) * DT;
      vz -= (dragMag * vz / speed + G) * DT;
    } else {
      vz -= G * DT;
    }
    x += vx * DT;
    y += vy * DT;
    z += vz * DT;
    if (z <= 0) return { x, y };
  }
  // Fallback: ball hasn't landed within 12s (shouldn't happen)
  return { x, y };
}

// ─── Assignment ──────────────────────────────────────────────────

/** Assign fielder roles after contact. Called once per batted ball.
 *  Returns the position of the primary fielder (the one tracking the ball).
 *  @param sprayAngleDeg - spray angle of the hit (-45 = pull left, +45 = pull right) */
export function assignFielderRoles(
  fielders: FielderEntity[],
  ball: BallEntity,
  predictedLanding: Point2D,
  sprayAngleDeg?: number,
  runners?: import('./entities').RunnerEntity[],
): string {
  const depthFt = Math.hypot(predictedLanding.x, predictedLanding.y);
  const isOutfieldBall = depthFt > INFIELD_CONTACT_DEPTH_FT;
  const spray = sprayAngleDeg ?? 0;

  // ─── SS/2B spray angle rules ──────────────────────────────────
  // Balls hit to the LEFT side (-45° to 0°): SS fields, 2B covers 2nd
  // Balls hit to the RIGHT side (1° to 45°): 2B fields, SS covers 2nd
  const ssFields = spray <= 0;   // left side of field
  const b2Fields = spray > 0;    // right side of field

  // Pitcher is only eligible for very short balls (<70ft) hit near the mound.
  // Real pitchers only field comebacers, bunts, and slow rollers — not
  // routine grounders that belong to the corner/middle infielders.
  const pitcherLateralOk = Math.abs(predictedLanding.x) <= 15;  // within 15ft of mound center
  const pitcherEligible = depthFt <= SHORT_CONTACT_DEPTH_FT && pitcherLateralOk;

  // Catcher is only eligible for balls in bunt/dribbler territory —
  // very close to home plate (<20 ft). Beyond that, the pitcher and
  // infielders handle it. Real catchers don't chase ground balls past
  // the mound.
  const CATCHER_MAX_DEPTH_FT = 20;
  const catcherEligible = depthFt <= CATCHER_MAX_DEPTH_FT;

  // Gray-zone overlap: balls in the 120-180ft range allow BOTH IF and OF
  let shortPool: Position[];
  if (pitcherEligible && catcherEligible) {
    shortPool = ['P', 'C', 'B1', 'B2', 'SS', 'B3'];
  } else if (pitcherEligible) {
    shortPool = ['P', 'B1', 'B2', 'SS', 'B3'];
  } else if (catcherEligible) {
    shortPool = ['C', 'B1', 'B2', 'SS', 'B3'];
  } else {
    shortPool = ['B1', 'B2', 'SS', 'B3'];
  }

  // ── 1B territory gate ──────────────────────────────────────────
  // 1B only fields balls within 10 ft of 1st base (63.6, 63.6).
  // Anything outside that radius is the 2B's responsibility.
  const FIRST_BASE_PT = { x: 63.6, y: 63.6 };
  const distFromFirstBase = Math.hypot(
    predictedLanding.x - FIRST_BASE_PT.x,
    predictedLanding.y - FIRST_BASE_PT.y,
  );
  const b1Eligible = distFromFirstBase <= 10;

  const primaryPool: Position[] = depthFt <= SHORT_CONTACT_DEPTH_FT
    ? shortPool.filter(p => p !== 'B1' || b1Eligible)
    : depthFt <= INFIELD_OF_GRAY_ZONE_FT
      ? (['B1', 'B2', 'SS', 'B3'] as Position[]).filter(p => p !== 'B1' || b1Eligible)
      : depthFt <= INFIELD_CONTACT_DEPTH_FT
        ? (['B1', 'B2', 'SS', 'B3', 'LF', 'CF', 'RF'] as Position[]).filter(p => p !== 'B1' || b1Eligible)
        : ['LF', 'CF', 'RF', 'SS', 'B2'];  // deep — OF primary, MIF can help (B1 never here)

  // Check if any infielder is already IN the ball's path (within ~15ft
  // of the trajectory line). This handles hard grounders hit AT a fielder.
  const ballDir = { x: predictedLanding.x - ball.pos.x, y: predictedLanding.y - ball.pos.y };
  const ballDirLen = Math.hypot(ballDir.x, ballDir.y) || 1;
  const ballDirNorm = { x: ballDir.x / ballDirLen, y: ballDir.y / ballDirLen };

  let interceptFielder: FielderEntity | undefined;
  let interceptDist = Infinity;
  for (const f of fielders) {
    // Consider infielders + pitcher + catcher for intercept
    if (!['P', 'C', 'B1', 'B2', 'SS', 'B3'].includes(f.position)) continue;

    // Pitcher gets a much tighter intercept radius (comebacker only)
    const maxPerp = f.position === 'P' ? 6 : 15;

    // Pitcher must also pass the lateral + depth eligibility check
    if (f.position === 'P' && !pitcherEligible) continue;
    // Catcher only intercepts bunts/dribblers near home
    if (f.position === 'C' && !catcherEligible) continue;
    // B1 only intercepts balls within 10 ft of 1st base
    if (f.position === 'B1' && !b1Eligible) continue;

    // Project fielder position onto ball trajectory line
    const toFielder = { x: f.pos.x - ball.pos.x, y: f.pos.y - ball.pos.y };
    const proj = toFielder.x * ballDirNorm.x + toFielder.y * ballDirNorm.y;
    if (proj < 0 || proj > ballDirLen) continue;  // behind the ball or past landing
    // Perpendicular distance from trajectory
    const perpDist = Math.abs(toFielder.x * (-ballDirNorm.y) + toFielder.y * ballDirNorm.x);
    if (perpDist < maxPerp && perpDist < interceptDist) {
      interceptDist = perpDist;
      interceptFielder = f;
    }
  }

  // Pick primary: intercept fielder takes priority for grounders, otherwise closest
  // closestFielder uses the ball direction vector to weight approach angle:
  // fielders the ball is heading toward get a distance bonus.
  const isGrounder = (ball.state.type === 'in-flight' && ball.state.vel.z < 5) || depthFt < 200;
  const primary = (interceptFielder && isGrounder && interceptDist < 12)
    ? interceptFielder
    : (closestFielder(fielders, predictedLanding, primaryPool, ballDir)
       ?? closestFielder(fielders, predictedLanding, undefined, ballDir));
  if (!primary) return '';

  // PI-based reaction delay: fielder reads the ball before breaking
  const reactionDelay = reactionDelaySec(primary.playIntelligence ?? 5);
  primary.state = { type: 'tracking', target: predictedLanding, reactionSec: reactionDelay };

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
      // Pitcher responsibilities mirror real baseball:
      // - Right-side grounders (spray > 0): cover 1B (1B fielder is pulling off the bag)
      // - Left-side grounders: back up 3B area
      // - Outfield balls: back up toward home
      if (isOutfieldBall) {
        f.state = { type: 'backing-up', target: { x: 0, y: 90 } };
      } else if (spray > 5) {
        // Right-side grounder — pitcher covers 1B
        f.state = { type: 'covering', base: getFielderCoverPoint('first', 'P') };
      } else if (spray < -5) {
        // Left-side grounder — pitcher backs up 3B side
        f.state = { type: 'backing-up', target: { x: -15, y: 75 } };
      } else {
        // Up-the-middle — pitcher backs up infield
        f.state = { type: 'backing-up', target: { x: 0, y: 70 } };
      }
    } else if (f.position === 'C') {
      // Catcher covers home plate
      f.state = { type: 'covering', base: getBaseAnchor('home') };
    } else if (isOF && f.position !== primary.position) {
      // Non-primary OF backs up to keep extra bases honest.
      const backupPt: Point2D = {
        x: (f.homePos.x + predictedLanding.x) / 2,
        y: (f.homePos.y + predictedLanding.y) / 2,
      };
      f.state = { type: 'backing-up', target: backupPt };
    } else if (isIF) {
      // ── SS/2B spray-angle rule ──────────────────────────────────
      if (f.position === 'SS') {
        if (primary.position === 'SS') {
          // SS is already primary — they're fielding
        } else if (ssFields) {
          // Ball to left side — SS backs up the play
          f.state = { type: 'backing-up', target: { x: -30, y: 120 } };
        } else {
          // Ball to right side — SS covers 2nd base
          if (isOutfieldBall && f.position === cutoffPos) {
            f.state = { type: 'cutting', relayPoint: cutoffPt };
          } else {
            f.state = { type: 'covering', base: getFielderCoverPoint('second', 'SS') };
          }
        }
      } else if (f.position === 'B2') {
        if (primary.position === 'B2') {
          // B2 is already primary — they're fielding
        } else if (b2Fields) {
          // Ball to right side — B2 backs up the play
          f.state = { type: 'backing-up', target: { x: 30, y: 120 } };
        } else {
          // Ball to left side — B2 covers 2nd base
          if (isOutfieldBall && f.position === cutoffPos) {
            f.state = { type: 'cutting', relayPoint: cutoffPt };
          } else {
            f.state = { type: 'covering', base: getFielderCoverPoint('second', 'B2') };
          }
        }
      } else if (f.position === 'B1') {
        // B1 almost always covers first for the throw (batter-runner heading there).
        // Exception: if ball is hit right at B1 (spray > 25° and short), B1 is already primary.
        f.state = { type: 'covering', base: getFielderCoverPoint('first', f.position) };
      } else if (f.position === 'B3') {
        // B3 only needs to cover third if a runner could advance there.
        // With no runners on second, third is empty — B3 should field balls
        // on their side instead of wasting themselves on an empty bag.
        const hasRunnerForThird = runners?.some(r =>
          (r.state.type === 'on-base' && r.state.base === 'second') ||
          (r.state.type === 'running')
        ) ?? false;

        if (hasRunnerForThird) {
          // Runner could advance to third — cover the bag
          f.state = { type: 'covering', base: getFielderCoverPoint('third', f.position) };
        } else if (spray < -10 && !isOutfieldBall) {
          // Ball hit to left side (B3's zone) with no runners at third —
          // B3 should track the ball as a secondary fielder.
          // If primary can't make the play, B3 is right there.
          const reactionDelay = reactionDelaySec(f.playIntelligence ?? 5);
          f.state = { type: 'tracking', target: predictedLanding, reactionSec: reactionDelay };
        } else {
          // Ball is hit to the opposite side or deep — back up
          f.state = { type: 'backing-up', target: { x: -40, y: 80 } };
        }
      } else {
        f.state = { type: 'returning' };
      }
    }
  }

  return primary.position;
}

// ─── Field context for inter-fielder awareness ──────────────────

/** Context passed to tickFielder so each fielder is aware of
 *  teammates, runners, game situation, and who the primary is. */
export interface FieldContext {
  allFielders: FielderEntity[];
  runners: import('./entities').RunnerEntity[];
  situation: import('./aiManager').GameSituation;
  primaryPosition: string;  // position of the designated primary fielder
}

// ─── Per-tick update ─────────────────────────────────────────────

/** Update a single fielder for one tick. */
export function tickFielder(
  fielder: FielderEntity,
  ball: BallEntity,
  dt: number,
  ctx?: FieldContext,
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
      const target = fielder.state.target;

      // ── Reaction delay: fielder reads the ball before breaking ──
      if (fielder.state.reactionSec != null && fielder.state.reactionSec > 0) {
        fielder.state.reactionSec -= dt;
        // During reaction, face the ball but don't move
        const toBall = angleToPoint(fielder.pos, { x: ball.pos.x, y: ball.pos.y });
        fielder.facingRad = rotateToward(fielder.facingRad, toBall, fielder.turnRateRad * dt);
        break;
      }

      // ── Yield logic: if another fielder is closer, back off ────
      if (ctx && ball.state.type === 'in-flight') {
        const myDist = dist2D(fielder.pos, target);
        const isPrimary = fielder.position === ctx.primaryPosition;

        if (!isPrimary) {
          // Tighter buffer (8ft) — fielders call each other off earlier
          const closerTeammate = ctx.allFielders.find(f =>
            f !== fielder &&
            (f.state.type === 'tracking' || f.state.type === 'chasing') &&
            dist2D(f.pos, target) < myDist - 8
          );
          if (closerTeammate) {
            const backupPt: Point2D = {
              x: (fielder.homePos.x + target.x) / 2,
              y: (fielder.homePos.y + target.y) / 2,
            };
            fielder.state = { type: 'backing-up', target: backupPt };
            break;
          }
        }
      }

      // ── Live re-prediction: update target as ball decelerates ───
      if (ball.state.type === 'in-flight') {
        const updated = predictLanding(ball);
        if (updated) fielder.state.target = updated;
      }

      moveToward(fielder, fielder.state.target, dt);

      // Check if we can catch the ball (collider-based)
      if (ball.state.type === 'in-flight') {
        const distToBall = dist2D(fielder.pos, ball.pos);
        // FLD (glove) + PI (route) determine catch radius
        const catchRadius = catchRadiusForSkills(
          fielder.defense ?? 5,
          fielder.playIntelligence ?? 5,
        );
        const ballInRange =
          distToBall < catchRadius &&
          ball.pos.z < 12 &&
          ball.pos.z > 0 &&
          isFacingPoint(fielder, { x: ball.pos.x, y: ball.pos.y }, CATCH_FACING_TOLERANCE_RAD);
        if (ballInRange) {
          const transfer = transferTimeSec(fielder.defense ?? 5, fielder.agility ?? 5);
          ball.state = { type: 'held', by: fielder.position };
          fielder.state = {
            type: 'has-ball',
            decideSec: decisionTimeSec(fielder.playIntelligence ?? 5) + transfer,
          };

          // KEY DISTINCTION: if the ball already bounced, this is a
          // ground-ball fielding play (must throw to first), NOT a fly out.
          const hasBounced = (ball.bounceCount ?? 0) > 0;
          if (hasBounced) {
            result.fielded = true;
            result.event = {
              type: 'ball-fielded',
              by: fielder.position,
              playerId: fielder.playerId > 0 ? fielder.playerId : undefined,
              at: { ...fielder.pos },
            };
          } else {
            result.caught = true;
            result.event = {
              type: 'ball-caught',
              by: fielder.position,
              playerId: fielder.playerId > 0 ? fielder.playerId : undefined,
              at: { ...fielder.pos },
            };
          }
        }
      }

      // If ball landed and is rolling, only the closest fielder chases
      if (ball.state.type === 'rolling' || ball.state.type === 'idle') {
        const ballPt = { x: ball.pos.x, y: ball.pos.y };
        const myDist = dist2D(fielder.pos, ballPt);

        // Tighter buffer (3ft) for tracking→chasing transition
        const closerChaser = ctx?.allFielders.find(f =>
          f !== fielder &&
          (f.state.type === 'tracking' || f.state.type === 'chasing') &&
          dist2D(f.pos, ballPt) < myDist - 3
        );

        if (closerChaser) {
          const backupPt: Point2D = {
            x: (fielder.homePos.x + ballPt.x) / 2,
            y: (fielder.homePos.y + ballPt.y) / 2,
          };
          fielder.state = { type: 'backing-up', target: backupPt };
        } else {
          fielder.state = { type: 'chasing', target: ballPt };
        }
      }
      break;
    }

    case 'chasing': {
      // Update chase target to ball's current position
      if (ball.state.type === 'rolling') {
        fielder.state.target = { x: ball.pos.x, y: ball.pos.y };
      }

      // ── Yield logic: if a teammate is closer to the ball, stop chasing ──
      if (ctx && (ball.state.type === 'rolling' || ball.state.type === 'idle')) {
        const ballPt = { x: ball.pos.x, y: ball.pos.y };
        const myDist = dist2D(fielder.pos, ballPt);
        // Tighter yield buffer (5ft) — fielders call off earlier
        const closerChaser = ctx.allFielders.find(f =>
          f !== fielder &&
          (f.state.type === 'chasing' || f.state.type === 'tracking') &&
          dist2D(f.pos, ballPt) < myDist - 5
        );
        if (closerChaser) {
          const backupPt: Point2D = {
            x: (fielder.homePos.x + ballPt.x) / 2,
            y: (fielder.homePos.y + ballPt.y) / 2,
          };
          fielder.state = { type: 'backing-up', target: backupPt };
          break;
        }
      }

      const arrived = moveToward(fielder, fielder.state.target, dt);

      // Check if close enough to pick up — FLD determines field radius
      const fieldRadius = fieldRadiusForSkills(fielder.defense ?? 5);
      const distToBall = dist2D(fielder.pos, ball.pos);
      if (distToBall < fieldRadius && ball.pos.z < 3 &&
          (ball.state.type === 'rolling' || ball.state.type === 'idle')) {
        // If within 2ft of the ball, auto-face it — you're standing on it,
        // just bend down and pick it up regardless of facing direction.
        // Beyond 2ft, still require facing check (approaching the ball).
        const veryClose = distToBall < 2;
        if (veryClose) {
          fielder.facingRad = angleToPoint(fielder.pos, { x: ball.pos.x, y: ball.pos.y });
        }
        const facingOk = veryClose ||
          isFacingPoint(fielder, { x: ball.pos.x, y: ball.pos.y }, FIELD_FACING_TOLERANCE_RAD);

        if (facingOk) {
          // FLD + AG determine transfer time (glove → hand → throwing position)
          const transfer = transferTimeSec(fielder.defense ?? 5, fielder.agility ?? 5);
          ball.state = { type: 'held', by: fielder.position };
          fielder.state = {
            type: 'has-ball',
            decideSec: decisionTimeSec(fielder.playIntelligence ?? 5) + transfer,
          };
          result.fielded = true;
          result.event = {
            type: 'ball-fielded',
            by: fielder.position,
            playerId: fielder.playerId > 0 ? fielder.playerId : undefined,
            at: { ...fielder.pos },
          };
        }
      }
      break;
    }

    case 'has-ball': {
      // Count down the PI-based decision timer (includes transfer time).
      // When it expires, if a throw target was provided, transition to
      // throwing with a position + AG-based windup.
      fielder.state.decideSec -= dt;
      if (fielder.state.decideSec <= 0 && fielder.state.throwTarget) {
        fielder.state = {
          type: 'throwing',
          target: fielder.state.throwTarget,
          throwBase: fielder.state.throwBase,
          windupSec: windupTimeSec(fielder.position, fielder.agility ?? 5),
        };
      }
      // If no throwTarget, the tick engine main loop will handle it
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
        throwBall(ball, fielder.pos, fielder.state.target, fielder.throwVeloFps, fielder.position,
          fielder.throwingSkill ?? 5, fielder.agility ?? 5);
        result.threw = true;
        result.event = {
          type: 'throw-released',
          from: fielder.position,
          fromId: fielder.playerId > 0 ? fielder.playerId : undefined,
          toBase: fielder.state.throwBase ?? 'unknown',
        };
        fielder.state = { type: 'returning' };
      }
      break;
    }

    case 'covering': {
      moveToward(fielder, fielder.state.base, dt);

      // ── Ball awareness: covering fielders can field/catch balls near them ──
      // Rolling or idle ball within field radius → pick it up
      if ((ball.state.type === 'rolling' || ball.state.type === 'idle') && ball.pos.z < 3) {
        const distToBall = dist2D(fielder.pos, ball.pos);
        const fieldRadius = fieldRadiusForSkills(fielder.defense ?? 5);
        if (distToBall < fieldRadius + 2) {
          // Auto-face and pick up
          fielder.facingRad = angleToPoint(fielder.pos, { x: ball.pos.x, y: ball.pos.y });
          const transfer = transferTimeSec(fielder.defense ?? 5, fielder.agility ?? 5);
          ball.state = { type: 'held', by: fielder.position };
          fielder.state = {
            type: 'has-ball',
            decideSec: decisionTimeSec(fielder.playIntelligence ?? 5) + transfer,
          };
          result.fielded = true;
          result.event = {
            type: 'ball-fielded',
            by: fielder.position,
            playerId: fielder.playerId > 0 ? fielder.playerId : undefined,
            at: { ...fielder.pos },
          };
          break;
        }
      }

      // In-flight ball within catch radius → catch it
      if (ball.state.type === 'in-flight') {
        const distToBall = dist2D(fielder.pos, ball.pos);
        const catchRadius = catchRadiusForSkills(fielder.defense ?? 5, fielder.playIntelligence ?? 5);
        if (distToBall < catchRadius && ball.pos.z < 12 && ball.pos.z > 0) {
          const transfer = transferTimeSec(fielder.defense ?? 5, fielder.agility ?? 5);
          ball.state = { type: 'held', by: fielder.position };
          fielder.state = {
            type: 'has-ball',
            decideSec: decisionTimeSec(fielder.playIntelligence ?? 5) + transfer,
          };
          result.caught = true;
          result.event = {
            type: 'ball-caught',
            by: fielder.position,
            playerId: fielder.playerId > 0 ? fielder.playerId : undefined,
            at: { ...fielder.pos },
          };
          break;
        }
      }

      // Check if a thrown ball arrives (collider-based)
      if (ball.state.type === 'thrown') {
        const distToBall = dist2D(fielder.pos, ball.pos);
        // Use a generous receive radius for covering fielders (they're
        // waiting for the ball, actively reaching for it)
        const receiveRadius = COLLIDERS.receiveThrow + 2;  // 8 ft
        if (distToBall < receiveRadius &&
            ball.pos.z < 10 &&
            ball.pos.z > 0) {
          // Auto-face incoming throw — fielders watching the throw
          // naturally turn to face it
          const toBall = angleToPoint(fielder.pos, { x: ball.pos.x, y: ball.pos.y });
          fielder.facingRad = toBall;

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
      // Sprint to backup position (90% speed — hustle, not jog)
      moveToward(fielder, fielder.state.target, dt, fielder.speedFps * 0.9);

      // ── Loose-ball instinct: if a rolling/idle ball is close, chase it ──
      if ((ball.state.type === 'rolling' || ball.state.type === 'idle') && ball.pos.z < 3) {
        const distToBall = dist2D(fielder.pos, ball.pos);
        // Only break from backup if ball is within 20ft and no one else is closer
        if (distToBall < 20) {
          const closerFielder = ctx?.allFielders.find(f =>
            f !== fielder &&
            (f.state.type === 'chasing' || f.state.type === 'tracking') &&
            dist2D(f.pos, ball.pos) < distToBall
          );
          if (!closerFielder) {
            fielder.state = { type: 'chasing', target: { x: ball.pos.x, y: ball.pos.y } };
          }
        }
      }
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
