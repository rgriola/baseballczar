/** Outcome codes from at-bat resolution */
export enum AtBatOutcome {
  Single = 1,
  Double = 2,
  Triple = 3,
  HomeRun = 4,
  Walk = 5,
  GroundOut = 6,
  Strikeout = 7,
}

/**
 * Coarse hit-direction zone, recorded per batted-ball event so the 2D
 * playback can place the ball where it actually went rather than always
 * sending it to the same fielder.
 *
 *   LF_LINE — down the 3B line, into the LF corner
 *   LF      — left field, in front of the LF
 *   LCF     — left-center gap (between LF and CF)
 *   CF      — straightaway center
 *   RCF     — right-center gap (between CF and RF)
 *   RF      — right field, in front of the RF
 *   RF_LINE — down the 1B line, into the RF corner
 *   INFIELD — weak grounder / infield (used for GroundOut)
 */
export type HitZone =
  | 'LF_LINE'
  | 'LF'
  | 'LCF'
  | 'CF'
  | 'RCF'
  | 'RF'
  | 'RF_LINE'
  | 'INFIELD';

/** Raw player skill attributes (1-10 scale, matching original Java engine) */
export interface PlayerSkills {
  ag: number;    // 1-10 Discipline — ratio of BB+K to in-play ABs
  avg: number;   // 1-10 Consistency — hit percentage
  power: number; // 1-10 Strength — doubles and HR ratio
  eye: number;   // 1-10 Plate vision — BB/K ratio
  dhr: number;   // 1-10 Doubles/HR distribution
  speed: number; // 1-10 Triples + baserunning
}

/** Pitcher-specific attributes (all 1-10 scale) */
export interface PitcherAttributes extends PlayerSkills {
  stamina: number;     // ST — 1-10, controls fatigue rate
}

/** Calculated skill thresholds used for at-bat RNG */
export interface SkillThresholds {
  S: number;   // Singles ceiling
  D: number;   // Doubles ceiling (cumulative)
  T: number;   // Triples ceiling (cumulative)
  HR: number;  // Home run ceiling (cumulative)
  BB: number;  // Walk ceiling (cumulative)
  K: number;   // Strikeout ceiling (cumulative)
  TOT: number; // Total skill score (AVG + POWER + EYE)
}

/** Per-at-bat stat line */
export interface PlateAppearanceStats {
  ab: number;
  b1: number;
  b2: number;
  b3: number;
  hr: number;
  rbi: number;
  bb: number;
  so: number;
  r: number;
}

/** Cumulative game stats */
export interface GameStats {
  ab: number;
  r: number;
  b1: number;
  b2: number;
  b3: number;
  hr: number;
  rbi: number;
  bb: number;
  so: number;
  hits: number;
}

/** Pitcher box score line */
export interface PitcherBoxLine {
  g: number;
  gs: number;
  w: number;
  l: number;
  sv: number;
  cg: number;
  sho: number;
  ip: number;
  om: number;   // outs made (IP = om / 3)
  bf: number;   // batters faced
  h: number;
  r: number;
  er: number;
  bb: number;
  so: number;
  hr: number;
}

/** Hitter identity for box score and runner tracking */
export interface HitterIdentity {
  playerId: number;
  jerseyNo: number;
  batOrder: number;
  position: string;
  firstName: string;
  lastName: string;
  displayName: string;
}

/** Runner on a base */
export interface RunnerState {
  respPitch: number; // index of pitcher responsible for putting runner on
  lineup: number;    // lineup slot of the runner
  playerId: number;
  jersey: number;
  lastName: string;
  speed: number;
  runs: number;      // 0 or 1 — flagged when runner scores
}

/** Scoreboard data for one team (inning-by-inning) */
export interface ScoreBoardTeamData {
  name: string;
  teamId: number;
  finalInning: number;
  totalRuns: number;
  totalHits: number;
  totalErrors: number;
  runs: number[];   // indexed by inning (1-based)
  hits: number[];
  errors: number[];
}

/** Full scoreboard for the game */
export interface ScoreBoardState {
  visitor: ScoreBoardTeamData;
  home: ScoreBoardTeamData;
}

/** A single game event for play-by-play log */
export interface GameEvent {
  inning: number;
  half: 'top' | 'bottom';
  outs: number;
  batterName: string;
  pitcherName: string;
  outcome: AtBatOutcome;
  description: string;
  visitorRuns: number;
  homeRuns: number;
  visitorHits: number;
  homeHits: number;
  runnersScored: string[];
  /**
   * Zone the ball was hit to (for batted balls). Null/undefined for
   * Walk and Strikeout. The 2D playback uses this to drive both the
   * landing point and which fielder makes the play.
   */
  hitZone?: HitZone;
}

/** Final game result */
export interface GameResult {
  homeTeamId: number;
  visitorTeamId: number;
  homeRuns: number;
  visitorRuns: number;
  homeHits: number;
  visitorHits: number;
  innings: number;
  winningTeamId: number;
  losingTeamId: number;
  events: GameEvent[];
  scoreBoard: ScoreBoardState;
  homePlayerStats: Map<number, GameStats>;
  visitorPlayerStats: Map<number, GameStats>;
  homePitcherStats: Map<number, PitcherBoxLine>;
  visitorPitcherStats: Map<number, PitcherBoxLine>;
}
