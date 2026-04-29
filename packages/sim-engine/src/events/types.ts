/**
 * Event schema for sim-lab playback.
 *
 * Each `*Event` interface is a self-contained record the renderer can
 * consume in isolation — it never has to look at the previous event
 * to understand what's happening *now*. The discriminated union
 * `SimEvent` is what the public `buildEvents` function returns.
 *
 * `SimEventInit` is the same union with `seq` / `t` stripped, used
 * internally by the builder when pushing events (the builder fills
 * those two fields in).
 */
import type { AtBatResult } from '../types';
import type { Position } from '../config';

export interface BaseEvent {
  seq: number;          // global sequence id within the game
  t: number;            // sim seconds since game start
}

export interface GameStartEvent extends BaseEvent {
  type: 'game-start';
  homeTeamId: number; homeTeamName: string;
  awayTeamId: number; awayTeamName: string;
}

export interface InningStartEvent extends BaseEvent {
  type: 'inning-start';
  inning: number; half: 'top' | 'bottom';
  battingTeamId: number; fieldingTeamId: number;
  defense: { position: Position; playerId: number; firstName: string; lastName: string; speed: number }[];
}

export interface AtBatStartEvent extends BaseEvent {
  type: 'at-bat-start';
  inning: number; half: 'top' | 'bottom'; outs: number;
  batter: { id: number; firstName: string; lastName: string; hand: 'L' | 'R' | 'S'; speed: number };
  pitcher: { id: number; firstName: string; lastName: string; hand: 'L' | 'R' };
  runners: (number | null)[];   // [1B, 2B, 3B] — playerIds or null
}

export interface PitchEvt extends BaseEvent {
  type: 'pitch';
  pitchNum: number; balls: number; strikes: number;
  intentZone: 'in' | 'edge' | 'off';
  actualInZone: boolean;
  swung: boolean;
  outcome: 'ball' | 'called-strike' | 'swinging-strike' | 'foul' | 'foul-out' | 'hbp' | 'in-play';
  flightSec: number;            // pitch travel time (fixed per type for now)
}

export interface ContactEvent extends BaseEvent {
  type: 'contact';
  exitVeloMph: number; launchAngleDeg: number; sprayAngleDeg: number;
  distanceFt: number; hangTimeSec: number;
  landingPoint: { x: number; y: number };
  isFoul: boolean; isHomeRun: boolean;
}

/**
 * Post-landing roll segment for a fly ball that drops fair and isn't
 * caught. Emitted at landing time (relative to the at-bat) so the
 * renderer can tween the ball along the grass from the landing point
 * toward where the fielder ultimately gloves it. `rollSec` is the
 * time the ball spends rolling (decelerating on grass) before the
 * fielder corrals it. For grounders and HRs no `ball-roll` is emitted.
 */
export interface BallRollEvent extends BaseEvent {
  type: 'ball-roll';
  fromPoint: { x: number; y: number };
  toPoint: { x: number; y: number };
  rollSec: number;
}

export interface FielderConvergeEvent extends BaseEvent {
  type: 'fielder-converge';
  position: Position; playerId: number;
  fromPoint: { x: number; y: number };
  toPoint: { x: number; y: number };
  reachSec: number;
}

export interface ThrowEvent extends BaseEvent {
  type: 'throw';
  fromPosition: Position; fromPlayerId: number;
  fromPoint: { x: number; y: number };
  toBase: 'first' | 'second' | 'third' | 'home';
  toPoint: { x: number; y: number };
  flightSec: number;
}

/**
 * Ball travelling back to the pitcher to end the dead-ball period.
 *
 *   `source = 'catcher'` : routine slow lob after a non-contact pitch
 *                          (ball, called/swinging strike, hbp).
 *   `source = 'fielder'` : the fielder who just made the play tosses
 *                          (or relays) it back. Used after every
 *                          batted-ball play except HR.
 *   `source = 'umpire'`  : umpire hands a fresh ball to the pitcher.
 *                          Used when the live ball left the field of
 *                          play (HR over the wall, foul into the
 *                          stands).
 *
 * The renderer animates only the ball — no fielder sprite moves.
 */
export interface BallReturnEvent extends BaseEvent {
  type: 'ball-return';
  fromPoint: { x: number; y: number };
  toPoint: { x: number; y: number };
  flightSec: number;
  source: 'catcher' | 'fielder' | 'umpire';
}

/**
 * Tells the renderer which fielder breaks to cover a base while a throw
 * is in the air. The cover fielder leaves their starting position and
 * arrives at the bag in `arriveSec` (timed so they reach the bag
 * fractionally before the ball does).
 */
export interface CoverBaseEvent extends BaseEvent {
  type: 'cover-base';
  position: Position;            // who is covering (e.g. B1)
  base: 'first' | 'second' | 'third' | 'home';
  fromPoint: { x: number; y: number };
  toPoint: { x: number; y: number };
  arriveSec: number;
}

/**
 * Phase 5.16: a fielder "layout" — a dive (low) or leap (high) at the
 * point of attempted catch. Emitted when the converge reach-time is
 * tight relative to ball hangtime so the renderer can play a one-shot
 * extension animation instead of just sliding the sprite. Renderer is
 * free to ignore this if it doesn't have art for it.
 */
export interface FielderDiveEvent extends BaseEvent {
  type: 'fielder-dive';
  position: Position; playerId: number;
  atPoint: { x: number; y: number };
  variant: 'dive' | 'leap';
  successful: boolean;
}

export interface RunnerAdvanceEvent extends BaseEvent {
  type: 'runner-advance';
  runnerId: number;
  fromBase: 'home' | 'first' | 'second' | 'third';
  toBase: 'first' | 'second' | 'third' | 'home';
  travelSec: number;
}

export interface OutEvent extends BaseEvent {
  type: 'out';
  outNum: number;                // outs in inning AFTER this play (1, 2, or 3)
  reason: AtBatResult;
  atPosition?: Position;         // who recorded the out
  runnerId?: number;             // for force outs / DPs / FCs
}

export interface RunScoredEvent extends BaseEvent {
  type: 'run-scored';
  runnerId: number;
  battingTeamId: number;
  scoreHome: number; scoreAway: number;
}

export interface AtBatEndEvent extends BaseEvent {
  type: 'at-bat-end';
  result: AtBatResult;
  rbis: number; runsScored: number;
}

export interface InningEndEvent extends BaseEvent {
  type: 'inning-end';
  inning: number; half: 'top' | 'bottom';
  scoreHome: number; scoreAway: number;
}

export interface GameEndEvent extends BaseEvent {
  type: 'game-end';
  scoreHome: number; scoreAway: number; innings: number;
}

export type SimEvent =
  | GameStartEvent | InningStartEvent | AtBatStartEvent
  | PitchEvt | ContactEvent | FielderConvergeEvent | ThrowEvent | CoverBaseEvent
  | FielderDiveEvent | BallReturnEvent | BallRollEvent
  | RunnerAdvanceEvent | OutEvent | RunScoredEvent
  | AtBatEndEvent | InningEndEvent | GameEndEvent;

/**
 * Discriminated-union-friendly form of `Omit<SimEvent, 'seq' | 't'>`.
 * `Omit<Union, K>` collapses the union and confuses TS literal narrowing;
 * this maps over each variant so the `type` discriminator still drives
 * which other keys are required/allowed.
 */
export type SimEventInit = {
  [K in SimEvent['type']]: Omit<Extract<SimEvent, { type: K }>, 'seq' | 't'>;
}[SimEvent['type']];
