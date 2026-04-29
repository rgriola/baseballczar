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
    /** Post-landing roll model. After a fly ball drops fair (and isn't
     *  caught), it bounces and rolls along its spray vector until grass
     *  friction stops it or it reaches the wall. The fielder must
     *  intercept somewhere along that roll. */
    roll: {
      /** Fraction of horizontal contact velocity retained after the
       *  first bounce. ~0.55 gives a ~50–70 ft natural roll on a
       *  100 mph LA-22° drive (matches MLB "shot to the gap" rollouts). */
      bounceKeepFrac: 0.55,
      /** Constant deceleration on outfield grass (ft/sec²) once the
       *  ball is rolling. Lower = ball rolls farther. */
      grassDecelFtPerSec2: 14,
      /** Energy retained after a wall ricochet. Padded MLB outfield
       *  walls absorb most of the impact — ball typically kicks back
       *  ~25 ft on a hard-hit liner off the fence. */
      wallBounceKeepFrac: 0.55,
      /** Fielder pursuit-loop max iterations. The intercept point is
       *  solved by fixed-point iteration; 6 is more than enough even
       *  with the piecewise (out + ricochet) ball-position model. */
      pursuitIterations: 6,
    },
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

  // ─── Fielding physics & territory ────────────────────────────
  // Knobs that govern how a fielder converges on a batted ball, picks
  // it up, and how the OF/IF aggression slack converts contact to
  // singles/doubles/triples. All extracted from battedBall.ts magic
  // numbers in Phase B.
  fielding: {
    /** Pickup time after the fielder/ball converge (glove transfer). */
    pickupSec: 0.4,
    /** Friction multiplier on a grounder's exit-velo as it rolls toward
     *  the fielder. 0.55 = the ball reaches the IF at ~55% of EV. */
    groundBallFrictionMul: 0.55,
    /** Floor on rolling speed (ft/sec) so very weak choppers still get
     *  a reasonable arrival time at the fielder. */
    minRollSpeedFps: 40,
    /** Per-degree territory penalty (sec) applied when a fly's spray
     *  angle is outside a fielder's natural zone. Keeps CF from poaching
     *  routine flies that geometrically belong to LF/RF. */
    territoryPenaltySecPerDeg: 0.012,
    /** Inside this radius (ft) from home, the C/P will compete for
     *  weak pop-ups and choppers regardless of launch angle. */
    shortBallRadiusFt: 45,
    /** Anything landing past this depth (ft from home) is conceptually
     *  outfield territory — infielders pay a steep per-ft penalty for
     *  retreating into it. Without this an SS/2B would routinely poach
     *  165–210 ft line drives where the OF is the rightful fielder. */
    infielderMaxNaturalDepthFt: 160,
    /** Sec/ft penalty added to an infielder's reach time for every foot
     *  the ball lands beyond `infielderMaxNaturalDepthFt`. 0.025 = a
     *  ball at 200 ft costs the IF an extra 1.0 sec, easily ceding the
     *  play to the OF unless no OF can possibly arrive. */
    infielderDepthPenaltySecPerFt: 0.025,
    /** Direction-of-motion penalty. A fielder charging the ball (toward
     *  home plate) runs at full effective range; a fielder backpedaling
     *  toward the wall runs at reduced range — he can't see the ball
     *  as well, has to track it over his shoulder, and physically moves
     *  slower running backward. Effective-range multiplier =
     *    backpedalMul + (chargeMul - backpedalMul) * (forwardness+1)/2
     *  where forwardness = dot(motionDir, towardHomeDir) ∈ [-1, 1].
     *  Default 0.6/1.0 means a full backpedal cuts range to 60%; pure
     *  lateral motion is 80%; charging is 100%. */
    chargeMul: 1.0,
    backpedalMul: 0.6,
    /** Each fielder's natural spray angle (deg, CF=0). Reaching outside
     *  this zone costs `territoryPenaltySecPerDeg` per deg of miss. */
    naturalSprayAngleDeg: {
      LF: -28, CF: 0, RF: +28,
      B3: -22, SS: -10, B2: +10, B1: +22,
    } as const,
    /** Foul-pop catch radii (ft from home) — how far each fielder will
     *  drift into foul ground for a pop-up. */
    foulCatch: {
      /** Default cap for corner IF / corner OF. */
      cornerDepthFt: 35,
      /** Catcher gets a wider chase radius for fouls in the dirt circle. */
      catcherDepthFt: 60,
      /** When a foul lands within this distance of home, bias the catcher
       *  by multiplying his reach time by `catcherShortBiasMul`. */
      catcherShortRadiusFt: 20,
      catcherShortBiasMul: 0.7,
    },
    /** Outfielder slack (sec) deciding how aggressively the runner takes
     *  an extra base. Smaller slack ⇒ more doubles/triples. */
    extraBaseSlackSec: {
      /** Used in single-vs-double decision (throw to 2B). */
      toSecond: 0.5,
      /** Used in double-vs-triple decision (throw to 3B). */
      toThird: 0.3,
    },
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
    // GIDP / opportunity. With baseline 0.42 and skill leverage,
    // average MIF turns ~42%; elite glove (def 9) turns ~58%.
    // Roughly matches MLB GIDP-per-opportunity rates.
    baseProb: 0.42,
    skillLeverage: 0.04,
  },

  baserunning: {
    sacFlyTagProb: 0.85,
    // Probability that a non-DP ground-out with a forced runner is
    // scored as a fielder's choice (lead runner out at the next bag,
    // batter safe). Combined with DP, ~70% of MIF grounders with R1
    // & < 2 outs put the lead runner out; the residual ~30% becomes
    // a routine ground-out at 1B with the forced runner advancing.
    fcProb: 0.50,
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
