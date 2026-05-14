// Last touched by agent: 2026-05-05T06:10:11Z
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
  bounceCount: number;   // how many times the ball has hit the ground (0 = never touched ground)
}

// ─── Fielder ─────────────────────────────────────────────────────
export type FielderState =
  | { type: 'idle' }                                           // at home position
  | { type: 'tracking'; target: Point2D; reactionSec?: number } // running to predicted landing
  | { type: 'chasing'; target: Point2D }                       // ball got past, redirecting
  | { type: 'has-ball'; decideSec: number; throwTarget?: Point2D; throwBase?: string }  // holding ball, deciding throw
  | { type: 'throwing'; target: Point2D; throwBase?: string; windupSec: number }   // windup animation
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
  agility: number;                   // 1-10 AG skill (drives turn rate)
  facingRad: number;                 // current facing direction (radians)
  turnRateRad: number;               // max turning speed (radians/sec)
  throwVeloFps: number;              // throw velocity (ft/sec)
  throwingSkill: number;             // 1-10 TH skill (raw, for accuracy calc)
  defense: number;                   // 1-10 defense skill
  playIntelligence: number;          // 1-10 PI — route reads, throw-target IQ
  playerId: number;
  jerseyNumber: number;              // 1-99, from DB jersey_no
  teamColor: number;
}

// ─── Runner ──────────────────────────────────────────────────────
export type RunnerState =
  | { type: 'on-base'; base: 'first' | 'second' | 'third' }
  | { type: 'running'; from: Point2D; to: Point2D }
  | { type: 'rundown'; fromBase: string; toBase: string; jukeTarget: Point2D }
  | { type: 'scored' }
  | { type: 'out' }

export interface RunnerEntity {
  id: number;
  pos: Point2D;
  state: RunnerState;
  speedFps: number;
  agility: number;                   // 1-10 AG skill (drives turn rate)
  playIntelligence: number;          // 1-10 PI — baserunning reads, extra-base decisions
  facingRad: number;                 // current facing direction (radians)
  turnRateRad: number;               // max turning speed (radians/sec)
  teamColor?: number;                // batting team uniform color (hex)
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
  /** Team names for the HUD scoreboard. */
  homeName?: string;
  awayName?: string;
  /** 2-3 letter abbreviations for compact HUD display. */
  homeAbbrev?: string;
  awayAbbrev?: string;
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
      batter: { id?: number; name: string; hand: string; avg: number; power: number; eye: number; speed: number };
      pitcher: { id?: number; name: string; hand: string; ctrl: number; stam: number; throwing: number };
      inning: number; half: 'top' | 'bottom'; outs: number;
      homeScore: number; awayScore: number;
      homeName: string; awayName: string;
      bases: string[];  // e.g. ['first', 'third']
    }
  | {
      type: 'at-bat-end';
      result: string;   // 'single', 'fly-out', etc.
      batterId?: number;
      batterName: string;
      rbis: number;
      fieldedBy?: string;  // position + name, e.g. "#14 Garcia (RF)"
    }
  // Ball events
  | {
      type: 'contact'; exitVeloMph: number; launchAngleDeg: number; sprayAngleDeg: number;
      batterId?: number;
      batterName?: string;
      sprayDirection: string;  // "LF", "RF-line", "CF", etc.
      distanceFt: number;
      peakHeightFt?: number;
      hangTimeSec?: number;
      isHomeRun?: boolean;
    }
  | { type: 'ball-landed'; at: Point2D }
  | { type: 'ball-caught'; by: string; playerId?: number; playerName?: string; at: Point2D }
  | { type: 'ball-fielded'; by: string; playerId?: number; playerName?: string; at: Point2D }
  | { type: 'throw-released'; from: string; fromId?: number; fromName?: string; toBase: string }
  | { type: 'ball-received'; by: string; playerId?: number; playerName?: string; at: Point2D }
  | { type: 'wall-bounce'; at: Point2D }
  | { type: 'wall-cleared'; at: Point2D; heightFt?: number }
  | { type: 'home-run'; distanceFt: number }
  // Runner events
  | { type: 'runner-safe'; runnerId: number; runnerName?: string; base: string }
  | { type: 'runner-out'; runnerId: number; runnerName?: string; at: string }
  | { type: 'runner-scored'; runnerId: number; runnerName?: string }
  // Pitch events
  | {
      type: 'pitch';
      pitchNum: number;
      batterId?: number;
      batterName?: string;
      pitcherId?: number;
      pitcherName?: string;
      zone: 'in' | 'edge' | 'off';
      actualInZone: boolean;
      speed: string;         // pitch type label: 'Four-seam', 'Changeup', etc.
      mph: number;           // actual pitch velocity
      swung: boolean;
    }
  | {
      type: 'pitch-result';
      outcome: string;
      balls: number;
      strikes: number;
      batterId?: number;
      pitcherId?: number;
      pitcherName?: string;
      /** Batter display name for richer pitch-result narration. */
      batterName?: string;
      /** Foul ball contact data — shows exit velo, LA, distance even on fouls */
      foulBall?: {
        exitVeloMph: number;
        launchAngleDeg: number;
        distanceFt: number;
        sprayDirection: string;
        peakHeightFt?: number;
      };
      /** Fair-ball contact data — mirrors foul metrics for in-play readouts */
      inPlayBall?: {
        exitVeloMph: number;
        launchAngleDeg: number;
        distanceFt: number;
        sprayDirection: string;
        peakHeightFt?: number;
      };
    }
  // Manager decision events (Phase 3)
  | { type: 'manager-signal'; decision: string; detail: string }
  | { type: 'defensive-shift'; positions: Record<string, Point2D> }
  // Error events
  | { type: 'fielding-error'; by: string; playerId?: number; playerName?: string; errorType: 'fielding' | 'throw'; at: Point2D }
  | { type: 'throwing-error'; by: string; playerId?: number; playerName?: string; at: Point2D; intendedBase: string }
  // Baserunning / pitching miscue events
  | { type: 'stolen-base'; runnerId: number; runnerName?: string; base: string }
  | { type: 'caught-stealing'; runnerId: number; runnerName?: string; at: string }
  | { type: 'wild-pitch'; pitcherId?: number; pitcherName?: string }
  | { type: 'passed-ball'; catcherId?: number; catcherName?: string }
  | { type: 'advanced-on-wild-pitch'; runnerId: number; runnerName?: string; from: string; to: string }
  | { type: 'pickoff-attempt'; base: string; pitcherName?: string }
  | { type: 'pickoff-out'; runnerId: number; runnerName?: string; at: string }
  | { type: 'pickoff-safe'; runnerId: number; runnerName?: string; at: string }
  | { type: 'hit-and-run'; runnerId: number; runnerName?: string }
  | { type: 'balk'; pitcherId?: number; pitcherName?: string }
  // Game flow
  | { type: 'play-complete' }
  | { type: 'inning-change'; inning: number; half: 'top' | 'bottom' }
  // Rundown events
  | { type: 'rundown-start'; runnerId: number; runnerName?: string; between: [string, string] }
  | { type: 'rundown-throw'; from: string; to: string }
  | { type: 'rundown-end'; runnerId: number; runnerName?: string; result: 'out' | 'safe'; at: string }
