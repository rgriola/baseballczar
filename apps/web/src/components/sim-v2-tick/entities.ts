/**
 * Entity types for the tick-based simulation engine.
 *
 * Every entity on the field (ball, fielders, runners) has a position
 * updated each tick and a state machine that drives its behavior.
 */
import type { Position } from '@baseballczar/sim-engine';

// ─── Shared ──────────────────────────────────────────────────────
export interface Point2D { x: number; y: number }
export interface Point3D { x: number; y: number; z: number }

// ─── Ball ────────────────────────────────────────────────────────
export type BallState =
  | { type: 'idle' }               // sitting on the mound / in a glove
  | { type: 'pitched'; vel: Point3D }
  | { type: 'in-flight'; vel: Point3D }      // batted ball flying through air
  | { type: 'rolling'; vel: Point2D }        // bouncing/rolling on the ground
  | { type: 'held'; by: string }             // in a fielder's or catcher's glove
  | { type: 'thrown'; vel: Point3D; target: Point2D; thrower: string }

export interface BallEntity {
  pos: Point3D;          // x, y in feet (engine coords), z = altitude
  state: BallState;
}

// ─── Fielder ─────────────────────────────────────────────────────
export type FielderState =
  | { type: 'idle' }                                           // at home position
  | { type: 'tracking'; target: Point2D }                      // running to predicted landing
  | { type: 'chasing'; target: Point2D }                       // ball got past, redirecting
  | { type: 'has-ball'; decideSec: number }                    // holding ball, deciding throw
  | { type: 'throwing'; target: Point2D; windupSec: number }   // windup animation
  | { type: 'covering'; base: Point2D }                        // covering a base
  | { type: 'cutting'; relayPoint: Point2D }                   // moving to cutoff position
  | { type: 'backing-up'; target: Point2D }                    // backup fielder
  | { type: 'returning' }                                      // jogging back to home position

export interface FielderEntity {
  position: Position;                // SS, CF, etc.
  pos: Point2D;                      // current location in feet
  homePos: Point2D;                  // default position
  state: FielderState;
  speedFps: number;                  // max sprint speed (ft/sec)
  throwVeloFps: number;              // throw velocity (ft/sec)
  defense: number;                   // 1-10 defense skill
  playerId: number;
  teamColor: number;
}

// ─── Runner ──────────────────────────────────────────────────────
export type RunnerState =
  | { type: 'on-base'; base: 'first' | 'second' | 'third' }
  | { type: 'running'; from: Point2D; to: Point2D }
  | { type: 'scored' }
  | { type: 'out' }

export interface RunnerEntity {
  id: number;
  pos: Point2D;
  state: RunnerState;
  speedFps: number;
}

// ─── Game state (for HUD overlay) ────────────────────────────────
/** Per-frame game context — injected by the orchestrator. */
export interface GameState {
  inning: number;
  half: 'top' | 'bottom';
  outs: number;
  homeScore: number;
  awayScore: number;
  /** Which bases are occupied (for diamond indicator). */
  basesOccupied: { first: boolean; second: boolean; third: boolean };
  /** Current batter name. */
  batter: string;
  /** Current pitcher name. */
  pitcher: string;
  /** At-bat index within the game (for timeline markers). */
  abIndex: number;
}

// ─── World snapshot ──────────────────────────────────────────────
/** One complete frame of the simulation — everything needed to render. */
export interface WorldSnapshot {
  time: number;               // simulation time in seconds
  ball: BallEntity;
  fielders: FielderEntity[];
  runners: RunnerEntity[];
  /** Events that happened this tick (catch, throw release, etc.) */
  events: TickEvent[];
  /** Game context for HUD overlay. */
  gameState?: GameState;
}

// ─── Tick events (emitted as things happen) ──────────────────────
export type TickEvent =
  // At-bat lifecycle (emitted by orchestrator)
  | {
      type: 'at-bat-start';
      batter: { name: string; hand: string; avg: number; power: number; eye: number; speed: number };
      pitcher: { name: string; hand: string; ctrl: number; stam: number };
      inning: number; half: 'top' | 'bottom'; outs: number;
      homeScore: number; awayScore: number;
      homeName: string; awayName: string;
      bases: string[];  // e.g. ['first', 'third']
    }
  | {
      type: 'at-bat-end';
      result: string;   // 'single', 'fly-out', etc.
      batterName: string;
      rbis: number;
      fieldedBy?: string;  // position + name, e.g. "S. Garcia (RF)"
    }
  // Ball events
  | {
      type: 'contact'; exitVeloMph: number; launchAngleDeg: number; sprayAngleDeg: number;
      sprayDirection: string;  // "LF", "RF-line", "CF", etc.
      distanceFt: number;
      peakHeightFt?: number;
      hangTimeSec?: number;
      isHomeRun?: boolean;
    }
  | { type: 'ball-landed'; at: Point2D }
  | { type: 'ball-caught'; by: string; playerName?: string; at: Point2D }
  | { type: 'ball-fielded'; by: string; playerName?: string; at: Point2D }
  | { type: 'throw-released'; from: string; fromName?: string; toBase: string }
  | { type: 'ball-received'; by: string; playerName?: string; at: Point2D }
  | { type: 'wall-bounce'; at: Point2D }
  | { type: 'home-run'; distanceFt: number }
  // Runner events
  | { type: 'runner-safe'; runnerId: number; base: string }
  | { type: 'runner-out'; runnerId: number; at: string }
  | { type: 'runner-scored'; runnerId: number }
  // Pitch events (Phase 3)
  | { type: 'pitch'; pitchNum: number; zone: 'in' | 'edge' | 'off'; speed: string }
  | { type: 'pitch-result'; outcome: string; balls: number; strikes: number }
  // Manager decision events (Phase 3)
  | { type: 'manager-signal'; decision: string; detail: string }
  | { type: 'defensive-shift'; positions: Record<string, Point2D> }
  // Game flow
  | { type: 'play-complete' }
  | { type: 'inning-change'; inning: number; half: 'top' | 'bottom' }
