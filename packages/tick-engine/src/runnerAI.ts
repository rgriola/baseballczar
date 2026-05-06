// Last touched by agent: 2026-05-05T07:22:00Z
/**
 * Per-tick runner AI — state-machine movement along the base paths.
 *
 * Runners follow the diamond path (home → 1B → 2B → 3B → home),
 * accelerating from 0 to top speed, then cruising. Their decisions
 * (advance, hold, tag-up) come from the AI Manager, not from the
 * runner itself — the runner only knows HOW to run, not WHERE.
 */
import type { RunnerEntity, Point2D } from './entities';
import { dist2D, COLLIDERS } from './spatial';
import { BASE_ANCHORS, getRunnerOnBasePoint, type OccupiedBase } from './fieldGeometry';

// ─── Base coordinates (feet, same as sim-engine) ─────────────────
export const BASE_POS: Record<string, Point2D> = {
  ...BASE_ANCHORS,
};

// Base path order for advancing
const BASE_ORDER = ['home', 'first', 'second', 'third'] as const;

/** Next base in order (wraps home). */
export function nextBase(current: string): string {
  const idx = BASE_ORDER.indexOf(current as typeof BASE_ORDER[number]);
  return BASE_ORDER[(idx + 1) % 4];
}

/** Previous base (for retreating). */
export function prevBase(current: string): string {
  const idx = BASE_ORDER.indexOf(current as typeof BASE_ORDER[number]);
  return BASE_ORDER[(idx - 1 + 4) % 4];
}

// ─── Runner acceleration model ───────────────────────────────────
// Matches the sim-engine: linear ramp from 0 to topSpeed over accelTime
const ACCEL_TIME = 1.2;  // seconds to reach full sprint
const BACKPEDAL_PENALTY = 0.5;
const BACKPEDAL_ANGLE_RAD = (120 * Math.PI) / 180;

/** Current speed (ft/s) given time spent accelerating. */
function currentSpeed(topSpeed: number, timeRunning: number): number {
  if (timeRunning >= ACCEL_TIME) return topSpeed;
  return topSpeed * (timeRunning / ACCEL_TIME);
}

function angleTo(from: Point2D, to: Point2D): number {
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

function setRunnerOnBase(runner: RunnerEntity, base: OccupiedBase): void {
  const holdPoint = getRunnerOnBasePoint(base);
  runner.state = { type: 'on-base', base };
  runner.pos.x = holdPoint.x;
  runner.pos.y = holdPoint.y;
}

// ─── State machine ───────────────────────────────────────────────

export interface RunnerCommand {
  type: 'advance' | 'hold' | 'retreat' | 'tag-up';
  /** Target base name (only for advance/retreat). */
  targetBase?: string;
}

/** Update a single runner for one tick. */
export function tickRunner(
  runner: RunnerEntity,
  dt: number,
): TickRunnerResult {
  const result: TickRunnerResult = {};

  switch (runner.state.type) {
    case 'on-base': {
      // Idle runners should stay oriented toward home plate.
      const targetFacing = angleTo(runner.pos, BASE_POS.home);
      runner.facingRad = rotateToward(
        runner.facingRad,
        targetFacing,
        runner.turnRateRad * dt,
      );
      break;
    }

    case 'running': {
      const target = runner.state.to;
      const dx = target.x - runner.pos.x;
      const dy = target.y - runner.pos.y;
      const dist = Math.hypot(dx, dy);

      if (dist < COLLIDERS.runnerOnBase) {
        // Arrived at target base
        runner.pos.x = target.x;
        runner.pos.y = target.y;
        result.arrivedAtBase = true;

        // Determine which base we reached
        const base = baseNameAt(target);
        if (base === 'home') {
          runner.state = { type: 'scored' };
          result.scored = true;
        } else {
          setRunnerOnBase(runner, base as OccupiedBase);
        }
        break;
      }

      // Calculate current speed with acceleration
      runner._runTime = (runner._runTime ?? 0) + dt;
      const desiredFacing = angleTo(runner.pos, target);
      runner.facingRad = rotateToward(
        runner.facingRad,
        desiredFacing,
        runner.turnRateRad * dt,
      );
      const facingError = Math.abs(angleDelta(runner.facingRad, desiredFacing));

      const speedBase = currentSpeed(runner.speedFps, runner._runTime);
      const speed = facingError > BACKPEDAL_ANGLE_RAD
        ? speedBase * BACKPEDAL_PENALTY
        : speedBase;
      const move = Math.min(speed * dt, dist);

      runner.pos.x += (dx / dist) * move;
      runner.pos.y += (dy / dist) * move;
      break;
    }

    case 'scored':
    case 'out': {
      // Terminal states — no movement
      break;
    }
  }

  return result;
}

/** Issue a command to a runner (from the AI Manager). */
export function commandRunner(runner: RunnerEntity, cmd: RunnerCommand): void {
  switch (cmd.type) {
    case 'advance': {
      const wasRunning = runner.state.type === 'running';
      const targetName = cmd.targetBase ?? (
        runner.state.type === 'on-base'
          ? nextBase(runner.state.base)
          : 'first'
      );
      const target = BASE_POS[targetName];
      if (!target) break;
      runner.state = {
        type: 'running',
        from: { ...runner.pos },
        to: target,
      };
      runner._runTime = wasRunning ? runner._runTime ?? 0 : 0;
      break;
    }
    case 'hold': {
      // Stop at current position (stay on base)
      if (runner.state.type === 'running') {
        const base = closestBase(runner.pos);
        if (base === 'home') {
          runner.state = { type: 'scored' };
        } else {
          setRunnerOnBase(runner, base as OccupiedBase);
        }
        runner._runTime = 0;
      }
      break;
    }
    case 'retreat': {
      const targetName = cmd.targetBase ?? (
        runner.state.type === 'on-base'
          ? runner.state.base  // stay put
          : 'first'
      );
      const target = BASE_POS[targetName];
      if (!target) break;
      runner.state = {
        type: 'running',
        from: { ...runner.pos },
        to: target,
      };
      runner._runTime = 0;  // restart acceleration (turning around)
      break;
    }
    case 'tag-up': {
      // Hold at current base until fly is caught, then advance
      // The AI Manager will issue 'advance' after the catch
      if (runner.state.type === 'running') {
        const base = closestBase(runner.pos);
        if (base === 'home') {
          runner.state = { type: 'scored' };
        } else {
          setRunnerOnBase(runner, base as OccupiedBase);
        }
        runner._runTime = 0;
      }
      break;
    }
  }
}

// ─── Spatial helpers ─────────────────────────────────────────────

/** Find which named base a point is closest to. */
function closestBase(pos: Point2D): string {
  let best = 'home';
  let bestDist = Infinity;
  for (const [name, pt] of Object.entries(BASE_POS)) {
    const d = dist2D(pos, pt);
    if (d < bestDist) {
      bestDist = d;
      best = name;
    }
  }
  return best;
}

/** Match a point to a base name (within tolerance). */
function baseNameAt(pos: Point2D): string {
  for (const [name, pt] of Object.entries(BASE_POS)) {
    if (dist2D(pos, pt) < COLLIDERS.runnerOnBase + 1) return name;
  }
  return 'home';
}

export interface TickRunnerResult {
  arrivedAtBase?: boolean;
  scored?: boolean;
}

// Extend RunnerEntity with internal acceleration tracking
declare module './entities' {
  interface RunnerEntity {
    /** Internal: time spent accelerating (seconds). */
    _runTime?: number;
  }
}
