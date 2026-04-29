/**
 * Core types for the sim-lab sandbox.
 * These are intentionally separate from the production `sim-engine` so
 * we can iterate without breaking integrations. Once stable, we'll
 * fold the winners back into `sim-engine`.
 */
import type { Position } from './config';

export type Hand = 'L' | 'R' | 'S';   // S = switch hitter

/**
 * All player skills are integers 1..10. Same scale as production.
 * Behavioral roles (the new mapping) live in their respective modules.
 */
export interface Skills {
  // Hitting
  ag: number;     // discipline / strike-zone judgment
  avg: number;    // contact rate when swinging
  power: number;  // exit velocity tier on contact
  eye: number;    // pitch recognition (called strikes vs balls)
  dhr: number;    // launch-angle bias (low = grounders, high = fly balls)
  speed: number;  // sprint speed + extra-base aggression
  // Pitching
  stamina: number;     // pitch-count fatigue threshold
  pitchIntel: number;  // pitch selection IQ + control
  // Fielding
  defense: number;     // range + glove + arm accuracy
}

export interface Player {
  id: number;
  firstName: string;
  lastName: string;
  hand: Hand;             // batting hand (and throwing for pitchers)
  position: Position;     // primary position
  skills: Skills;
}

export interface Team {
  id: number;
  name: string;
  abbrev: string;
  roster: Player[];       // 25 players
  lineup: Player[];       // 9 starters
  rotation: Player[];     // 5 SP
  bullpen: Player[];      // 7 RP
  bench: Player[];        // remainder
}

export type PitchOutcome =
  | 'ball'
  | 'called-strike'
  | 'swinging-strike'
  | 'foul'
  | 'foul-out'
  | 'hbp'
  | 'in-play';

export type AtBatResult =
  | 'walk' | 'hbp' | 'strikeout'
  | 'single' | 'double' | 'triple' | 'home-run'
  | 'ground-out' | 'fly-out' | 'line-out' | 'pop-out' | 'foul-out'
  | 'fielders-choice' | 'double-play' | 'sac-fly' | 'reached-on-error';

export interface PitchEvent {
  pitchNum: number;
  balls: number;
  strikes: number;
  intentZone: 'in' | 'edge' | 'off';
  actualInZone: boolean;
  swung: boolean;
  outcome: PitchOutcome;
}

export interface BattedBall {
  exitVeloMph: number;
  launchAngleDeg: number;
  sprayAngleDeg: number;     // 0° = LF foul line, 45° = CF, 90° = RF foul line
  distanceFt: number;
  hangTimeSec: number;
  landingPoint: { x: number; y: number };  // ft, origin = home plate
  isFoul: boolean;
  isHomeRun: boolean;
}

export interface AtBatRecord {
  inning: number;
  half: 'top' | 'bottom';
  outs: number;
  batter: Player;
  pitcher: Player;
  pitches: PitchEvent[];
  result: AtBatResult;
  battedBall?: BattedBall;
  fieldedBy?: Position;
  /**
   * Fielding credits for this play. Populated by `atBat.ts` from
   * (result, fieldedBy) using standard scorekeeping conventions:
   *  - putoutBy: the fielder who recorded the out (catch, tag, force)
   *  - assistBy: every fielder who handled the ball EXCLUDING the
   *    putout fielder (e.g. SS—92—B1: SS gets the assist, B1 the PO)
   *  - errorBy: fielder charged with the error on a ROE / misplay
   * Multiple outs (DP) record both putouts in `extraPutouts`.
   */
  fielding?: {
    putoutBy?: Position;
    assistBy?: Position[];
    errorBy?: Position;
    extraPutouts?: Position[];
  };
  rbis: number;
  runsScored: number;
}

export interface PitcherGameStats {
  pitcherId: number;
  battersFaced: number;
  pitches: number;
  outs: number;            // outs recorded
  hits: number;
  runs: number;
  earnedRuns: number;
  walks: number;
  strikeouts: number;
  homeRuns: number;
}

export interface BatterGameStats {
  batterId: number;
  pa: number;
  ab: number;
  hits: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  walks: number;
  strikeouts: number;
  runs: number;
  rbis: number;
}

/**
 * Per-game fielding line for a single defender. PO + A + E follow
 * standard MLB scorekeeping. `chances = po + a + e`.
 */
export interface FielderGameStats {
  playerId: number;
  position: Position;
  putouts: number;
  assists: number;
  errors: number;
}

export interface GameResult {
  homeTeam: Team;
  awayTeam: Team;
  homeRuns: number;
  awayRuns: number;
  innings: number;
  atBats: AtBatRecord[];
  pitcherStats: Map<number, PitcherGameStats>;
  batterStats: Map<number, BatterGameStats>;
  fielderStats: Map<number, FielderGameStats>;
}
