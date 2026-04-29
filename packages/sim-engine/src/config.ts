/**
 * ═══════════════════════════════════════════════════════════════════
 * SIM-LAB CONFIG — All tunable knobs in one place
 * ═══════════════════════════════════════════════════════════════════
 *
 * This file is the SINGLE source of truth for every magic number in
 * the sandbox simulation. Tweak values here, re-run the CLI, and see
 * the effect on rate stats. Nothing else in `sim-lab/` should declare
 * raw constants.
 *
 * Run:  npx tsx scripts/sim-lab.ts [--games 162] [--seed 42] [--verbose]
 *
 * ─── Calibration version ────────────────────────────────────────────
 * CONFIG_V1 (post-Phase-8.5, 162-game @ seed 1):
 *   bbPct .085 ✓ | kPct .251 ✓ | babip .322 (~.012 over) | hrPerFb .148 (~.008 over)
 *   pitchesPerPa 4.24 (~) | pitchesPerGame 168 (~) | runs 4.08 ✓ | fouls 1.22 ✓
 *   per-team-game: 4.08 R / 8.91 H / 0.46 2B / 0.05 3B / 0.89 HR
 *   HBP 0.48 / E 0.31 / DP 0.41 / FC 0.52 / SF 0.10
 *   All Phase-5 outcomes firing; all 9 skills monotonically leveraged.
 *   Phase 8.5 fix: runner-on-3B no longer silently dropped on a walk.
 */

export const CONFIG = {
  // ─── Park geometry (feet) ─────────────────────────────────────
  park: {
    leftLineFt: 320,
    leftCenterFt: 375,
    centerFt: 405,
    rightCenterFt: 375,
    rightLineFt: 320,
    wallHeightFt: 10,            // simple home-run gate; > distance ⇒ HR
    foulTerritoryDepthFt: 60,    // OF can drift this far foul to make catches
  },

  // ─── Ball flight ──────────────────────────────────────────────
  // Simple physics with a drag coefficient tuned so 105mph @ 28° ≈ 420ft.
  flight: {
    gravityFtPerSec2: 32.174,
    dragCoeff: 0.0078,           // tune knob — lower = ball carries farther
    mphToFps: 1.467,             // 1 mph ≈ 1.467 ft/sec
  },

  // ─── Throw velocities (mph) by position ───────────────────────
  // Higher defense skill adds velocity (see throw.ts). OF crow-hop bonus.
  throwVeloBaseMph: {
    P:  85, C:  82,
    B1: 80, B2: 82, SS: 86, B3: 84,
    LF: 86, CF: 88, RF: 88,
  } as Record<Position, number>,
  outfieldCrowHopMph: 5,         // OF gains this on long throws
  releaseTimeSec: 1.0,           // time from glove to throw release
  outfieldReleaseTimeSec: 1.3,   // crow-hop adds delay

  // ─── Runner speeds (sprint, ft/sec) ───────────────────────────
  // Skill 10 ≈ Trea Turner; Skill 1 ≈ Yadi-late-career.
  runner: {
    minFtPerSec: 22,             // skill 1
    maxFtPerSec: 28,             // skill 10
    leftyHeadStartSec: 0.3,      // L-handed batter to 1B advantage
    secondaryLeadFt: 12,         // baserunner lead off bag
    reactionToBatSec: 0.4,       // delay between contact and runner moving
  },

  // ─── Fielder reaction & range ─────────────────────────────────
  fielder: {
    reactionSec: 0.3,
    rangeFtPerSec: 32,           // average range; modulated by speed/defense
    catchRadiusFt: 10,           // ball within this of fielder = caught (line-drive)
  },

  // ─── Batted-ball distributions ────────────────────────────────
  // Skill→tendency mapping. These are the v1 levers.
  battedBall: {
    // Exit velocity tier in mph by power skill (1..10)
    powerToExitVeloMph: { min: 67, max: 106 },
    // Launch angle bias by dhr skill: 1=worm-burner, 10=uppercut
    dhrToLaunchAngleDeg: { min: -15, max: 25 },
    launchAngleStdDevDeg: 12,    // gaussian noise around the bias
    exitVeloStdDevMph: 8,
    // Spray angle convention: 0° = dead CF, -45° = LF foul line, +45° = RF.
    // RHB pulls to -pullCenterDeg, LHB to +pullCenterDeg. StdDev keeps most
    // contact inside the fair wedge while still allowing oppo-field hits.
    pullCenterDeg: 22,
    sprayStdDevDeg: 18,
  },

  // ─── Pitch-by-pitch outcome rolls ─────────────────────────────
  pitch: {
    baseInZoneRate: 0.50,        // pitcher's intent translation
    baseSwingInZoneRate: 0.72,
    baseChaseRate: 0.22,
    baseContactRate: 0.88,       // when swinging
    foulRate: 0.58,              // of all contact, share that's foul
    twoStrikeFoulRetains: true,  // long ABs
    maxPitchesPerAB: 20,         // safety
    edgeIsStrikeProb: 0.36,      // umpire calls edge pitch a strike this often
    hbpProb: 0.005,              // chance an inside-miss hits the batter (~0.5%)
  },

  // ─── Errors & double plays ───────────────────────────────────
  errors: {
    // Per-batted-ball *fielding* error chance (boot the grounder, drop
    // the fly), scaled by defense skill. Excludes throw errors.
    grounderErrorBase: 0.030,
    flyErrorBase: 0.008,
    /** Per-throw error chance (airmail, one-hop, pulled cover off bag)
     *  on plays where the IF must throw across the diamond. Scaled by
     *  defense skill. Throw errors let the batter reach AND advance
     *  any existing runner one extra base. */
    throwErrorBase: 0.012,
    skillLeverage: 0.006,        // per skill point off 5
  },

  doublePlay: {
    baseProb: 0.30,              // GIDP / opportunity
    skillLeverage: 0.04,
  },

  baserunning: {
    sacFlyTagProb: 0.85,
    fcProb: 0.20,
  },

  // ─── Manager logic ────────────────────────────────────────────
  manager: {
    starterMaxPitches: 100,
    starterTargetIp: 6,
    relieverMaxPitches: 25,
    bullpenWarningPitches: 90,   // start warming bullpen
    pinchHitPlatoonAdvantage: true,
  },

  // ─── Game ─────────────────────────────────────────────────────
  game: {
    maxInnings: 18,              // safety on extra innings
    rosterSize: 25,
    lineupSize: 9,
    rotationSize: 5,             // SP slots in roster
    bullpenSize: 7,
  },

  // ─── Reporting ────────────────────────────────────────────────
  expectedRanges: {
    bbPct:        [0.07, 0.11],
    kPct:         [0.18, 0.26],
    babip:        [0.290, 0.310],
    hrPerFb:      [0.10, 0.14],
    pitchesPerPa: [3.6, 4.0],
    pitchesPerGame: [135, 160],  // per team
    runsPerGame:  [3.5, 5.5],    // per team
    foulsPerPa:   [1.2, 1.8],
  },
} as const;

export type Position = 'P' | 'C' | 'B1' | 'B2' | 'SS' | 'B3' | 'LF' | 'CF' | 'RF';
export const POSITIONS: Position[] = ['P', 'C', 'B1', 'B2', 'SS', 'B3', 'LF', 'CF', 'RF'];
