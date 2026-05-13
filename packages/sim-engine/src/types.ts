/**
 * Core types for the sim-lab sandbox.
 * These are intentionally separate from the production `sim-engine` so
 * we can iterate without breaking integrations. Once stable, we'll
 * fold the winners back into `sim-engine`.
 */
import type { Position } from './config';

export type Hand = 'L' | 'R' | 'S';   // S = switch hitter

/**
 * All player skills are fractional at game time (1..10 on DB).
 * Same scale as production. Every skill applies to ALL players —
 * pitchers, batters, and fielders alike.
 *
 * Source of truth: meaning-of-skills.md
 */
export interface Skills {
  // ─── Physical ───
  /** SPD — Sprint speed. 0 = 5.3s 40yd, 10 = 4.2s 40yd.
   *  Used in baserunning timing AND fielding range. */
  speed: number;
  /** AG — Agility. Direction changes, reaction time, fielding
   *  transitions (DP pivot, cutoff relay). High AG + SPD → play SS/2B. */
  ag: number;
  /** ST — Stamina. Pitchers: skill decline over pitch count + recovery.
   *  Fielders: slight in-game decline + day-to-day fatigue/rest needs. */
  stamina: number;

  // ─── Hitting ───
  /** EYE — Pitch recognition / plate discipline. Drives swing/take
   *  decisions for batters. For pitchers: pitch control (walk rate). */
  eye: number;
  /** AVG — Contact quality. Hitting to gaps, down the line, fouling
   *  off close pitches. Pitchers: opposing force to batter AVG. */
  avg: number;
  /** STR/PWR — How hard the ball is hit (exit velocity).
   *  Pitchers: offsets batter power. */
  power: number;
  /** DHR — Launch angle bias. Hidden attribute.
   *  Low = groundball hitter, High = flyball/HR hitter. */
  dhr: number;

  // ─── Fielding ───
  /** FLD — Glove, hands, clean plays. Error rate: 0 = ~10%, 10 = ~1%.
   *  PI + SPD + AG + FLD + TH all contribute at different play stages. */
  fielding: number;
  /** TH — Arm strength. 0 = 80 mph, 10 = 105 mph.
   *  Used for pitcher velocity, OF throws home, IF throws across diamond. */
  throwing: number;

  // ─── Mental ───
  /** PI — Play Intelligence. Situational decision-making for EVERYONE:
   *  pitch selection, batter decisions, run/hit choices, fielding reads. */
  playIntelligence: number;

  // ─── Hidden ───
  /** BNT — Bunting skill. Hidden, deferred until bunt situations are
   *  implemented. How well a batter bunts + pitcher defends the bunt. */
  bunting?: number;
  /** Karma — Clutch factor in high-pressure situations. Hidden.
   *  Helps players overcome challenging moments. */
  karma?: number;
}

export interface Player {
  id: number;
  jerseyNumber: number;   // 1-99, unique within a team — visible on uniform
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
  | 'base-hit'  // OF hit — tick-engine resolves to single/double/triple dynamically
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
  /** Pitch velocity in mph — skill-derived, includes fatigue + pitch-type discount.
   *  Single source of truth: computed in atBat.ts, consumed by tick-engine for display. */
  mph: number;
  /** Human-readable pitch type label: 'Four-seam', 'Slider', 'Changeup', etc. */
  pitchType: string;
  /** Physics for any contact (fair OR foul). Present whenever the bat
   *  meets the ball, so the renderer can show launch/exit-velo/landing
   *  for foul balls just like fair balls. Absent on takes / whiffs. */
  battedBall?: BattedBall;
  /** When a foul fly is caught for an out, the fielder credited with
   *  the putout. Set in tandem with `outcome === 'foul-out'`. */
  foulCaughtBy?: Position;
}

export interface BattedBall {
  exitVeloMph: number;
  launchAngleDeg: number;
  sprayAngleDeg: number;     // 0° = CF, +90° = RF foul, -90° = LF foul
  distanceFt: number;
  hangTimeSec: number;
  /** Apex of the ball flight in feet from the kinematic flight model.
   *  ~2 ft for grounders; can exceed 100 ft for towering pop-ups. */
  peakHeightFt: number;
  landingPoint: { x: number; y: number };  // ft, origin = home plate
  /** Where the ball would come to rest if no fielder intercepts the
   *  post-landing roll. For grounders this equals `landingPoint`. For
   *  fly balls that drop fair, the ball bounces and rolls past
   *  `landingPoint` along its spray vector until grass friction stops
   *  it. If the natural roll exceeds the room to the wall, the ball
   *  ricochets back toward the infield with `wallBounceKeepFrac` of
   *  its at-wall velocity — `restPoint` reflects that final settle. */
  restPoint: { x: number; y: number };
  /** How far the ball rolls AFTER landing (ft). 0 for grounders (the
   *  rollout is already in `distanceFt`) and HRs. For wall-bounces
   *  this is the TOTAL ground covered (out + back), not the net
   *  displacement from landing. */
  rollDistanceFt: number;
  /** Horizontal speed at the moment the ball touches grass (ft/sec).
   *  Used by the OF pursuit solver to compute time-along-roll. */
  landingSpeedFps: number;
  /** Set when the ball reached the outfield wall with energy to
   *  spare. The point on the wall the ball struck (engine feet). The
   *  visualizer animates a two-segment roll (landing→wall, then
   *  wall→restPoint) when this is present. */
  wallHitPoint?: { x: number; y: number };
  /** Ball speed (ft/sec) the instant after the wall ricochet —
   *  the back-traveling roll segment starts at this velocity and
   *  decelerates with `grassDecelFtPerSec2`. */
  wallBounceSpeedFps?: number;
  /** For grounders intercepted by an infielder before they reach their
   *  natural landing point: where the fielder actually gloved the ball.
   *  The renderer + fielder-converge / throw events use this when set;
   *  the hit-classifier still uses `landingPoint` / `distanceFt` (true
   *  ball physics) to decide single vs double vs triple. */
  fieldedAtPoint?: { x: number; y: number };
  /** Time (seconds since contact) at which the fielder gloves the ball
   *  at `fieldedAtPoint`. For caught flies this equals `hangTimeSec`.
   *  For non-caught flies it includes the chase along the post-landing
   *  roll. The visualizer uses this to time the converge animation so
   *  the fielder arrives at the intercept point as the ball gets there. */
  fieldedAtSec?: number;
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
  /** When `result === 'reached-on-error'`, distinguishes a muffed ball
   *  ('fielding') from a wild throw ('throw'). On throw errors, every
   *  existing baserunner takes one extra base. */
  errorType?: 'fielding' | 'throw';
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
  /**
   * Phase 4 — Per-runner advance decisions made by the engine. Lets
   * the visualizer (events/baseRunning.ts) emit the same path the
   * engine resolved instead of re-deciding from `result` alone.
   * Currently only `r1` on a single is PI-gated; future fields can
   * carry tag-up reads, etc. Absent fields = use the textbook default.
   */
  runnerAdvances?: {
    /** Where r1 ended up on a single. Default 'third'. */
    r1OnSingle?: 'second' | 'third';
  };
  /**
   * Physics metadata for outfield hits (`result === 'base-hit'`).
   * The tick-engine uses this to simulate the play and determine
   * how many bases the runner takes dynamically.
   */
  outfieldPhysics?: {
    interceptPoint: { x: number; y: number };
    totalToBallSec: number;
    fielderPosition: Position;
    fielderThrowSkill: number;
    fielderSpeedSkill: number;
  };
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
