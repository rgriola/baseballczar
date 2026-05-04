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

// ─── Base coordinates (feet, same as sim-engine) ─────────────────
export const BASE_POS: Record<string, Point2D> = {
  home:   { x: 0, y: 0 },
  first:  { x: 63.6, y: 63.6 },
  second: { x: 0, y: 127.3 },
  third:  { x: -63.6, y: 63.6 },
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

/** Current speed (ft/s) given time spent accelerating. */
function currentSpeed(topSpeed: number, timeRunning: number): number {
  if (timeRunning >= ACCEL_TIME) return topSpeed;
  return topSpeed * (timeRunning / ACCEL_TIME);
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
      // Idle — waiting for a command from the AI Manager
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
          runner.state = { type: 'on-base', base: base as 'first' | 'second' | 'third' };
        }
        break;
      }

      // Calculate current speed with acceleration
      runner._runTime = (runner._runTime ?? 0) + dt;
      const speed = currentSpeed(runner.speedFps, runner._runTime);
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
      runner._runTime = runner._runTime ?? 0;  // preserve momentum if already running
      break;
    }
    case 'hold': {
      // Stop at current position (stay on base)
      if (runner.state.type === 'running') {
        const base = closestBase(runner.pos);
        runner.state = { type: 'on-base', base: base as 'first' | 'second' | 'third' };
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
        runner.state = { type: 'on-base', base: base as 'first' | 'second' | 'third' };
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
