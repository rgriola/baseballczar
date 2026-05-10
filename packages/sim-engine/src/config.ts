// Last touched by agent: 2026-05-07T21:54:13Z
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
  // Statcast-calibrated drag-factor model.
  //   distance = vacRange × dragFactor
  //   vacRange = v² × sin(2θ) / g
  //   dragFactor = clamp(0.55, 0.95, 1.05 - mph × 0.0042)
  // Drag factor constants live in ballFlight.ts (not here) since
  // they're tightly coupled to the formula.
  flight: {
    gravityFtPerSec2: 32.174,
    mphToFps: 1.467,               // 1 mph ≈ 1.467 ft/sec
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

  // ─── Runner / sprint speeds (ft/sec) ───────────────────────────
  // One body, one speed — same curve for baserunning AND fielding.
  // Skill 10 ≈ elite burner; Skill 1 ≈ slow catcher.
  runner: {
    minFtPerSec: 22.64,          // skill 1  (≈15.4 mph)
    maxFtPerSec: 28.57,          // skill 10 (≈19.5 mph)
    leftyHeadStartSec: 0.3,      // L-handed batter to 1B advantage
    secondaryLeadFt: 12,         // baserunner lead off bag
    reactionToBatSec: 0.4,       // delay between contact and runner moving
    /** Standardized acceleration curve. A player needs `accelTimeSec`
     *  seconds of running before they reach full sprint speed. Before
     *  that, effective speed ramps linearly from 0 to `sprintFtPerSec`.
     *  Applies to BOTH baserunning and fielding. */
    accelTimeSec: 0.6,           // ~0.6s to hit top speed from a stand
  },

  // ─── Fielder reaction & range ─────────────────────────────────
  // Fielder foot speed comes from `sprintFtPerSec(speed)` — the SAME
  // function used for baserunning. Defense skill improves the fielder's
  // jump (reaction time) and route efficiency, NOT raw foot speed.
  fielder: {
    reactionSec: 0.25,           // base reaction (read + first step)
    /** Defense skill reduces reaction time: each point above 5 shaves
     *  `defenseReactionBonusSec` off. Skill 10 reacts 0.25s faster;
     *  Skill 1 reacts 0.25s slower. Models jump quality + read ability. */
    defenseReactionBonusSec: 0.05,
    /** Defense also improves route efficiency: a perfect route (1.0)
     *  means the fielder runs the shortest path. Low defense takes a
     *  longer, less efficient path. Effective distance multiplier:
     *    routeMul = routeBase + (defense - 5) * routeLeverage
     *  Skill 5 = 1.0 (no penalty). Skill 10 = 0.95 (5% shorter route).
     *  Skill 1 = 1.08 (8% longer route). */
    routeBase: 1.0,
    routeLeverage: -0.02,
    catchRadiusFt: 12,           // ball within this of fielder = caught (line-drive)
    /** Catch tolerance for in-air balls: fielder may arrive slightly
     *  after landing and still convert a running/diving catch.
     *  Tightened from prior baseline to reduce overly generous catches.
     *  Skill 5 = 0.65s, Skill 10 = 0.85s, Skill 1 = 0.49s. */
    catchSlackBaseSec: 0.65,
    catchSlackDefenseLeverageSec: 0.04,
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
    backpedalMul: 0.75,
    /** Each fielder's natural spray angle (deg, CF=0). Reaching outside
     *  this zone costs `territoryPenaltySecPerDeg` per deg of miss. */
    naturalSprayAngleDeg: {
      // Match the OF starting positions in physics/positions.ts so the
      // territory penalty is zero at the spot the fielder actually stands.
      LF: -31, CF: 0, RF: +31,
      B3: -22, SS: -10, B2: +10, B1: +22,
    } as const,
    /** A ball landing past `cornerCaromAngleDeg` (in absolute spray)
     *  is treated as a corner shot — it skips into the corner, off
     *  the side wall, off the warning track, and is harder to retrieve.
     *  The OF reach time gets a flat `cornerCaromPenaltySec` bump,
     *  which is what produces real triples (slow runner stays at 2B,
     *  fast runner stretches it). Set penalty to 0 to disable. */
    cornerCaromAngleDeg: 36,
    cornerCaromPenaltySec: 0.6,
    /* Per-fielder range model (post-unification):
     *  Foot speed = sprintFtPerSec(speed) — same as baserunning.
     *  Defense affects reaction (jump) and route efficiency only.
     *  rangeDefenseLeverageFps and rangeSpeedLeverageFps are REMOVED;
     *  kept here as 0 for any code that still references them during
     *  transition, but the real model lives in fielder.* above. */
    rangeDefenseLeverageFps: 0,
    rangeSpeedLeverageFps:   0,
    /** Foul-pop catch radii (ft from home) — how far each fielder will
     *  drift into foul ground for a pop-up. */
    foulCatch: {
      /** Default cap for corner IF / corner OF. */
      cornerDepthFt: 55,
      /** Catcher gets a wider chase radius for fouls in the dirt circle. */
      catcherDepthFt: 80,
      /** When a foul lands within this distance of home, bias the catcher
       *  by multiplying his reach time by `catcherShortBiasMul`. */
      catcherShortRadiusFt: 20,
      catcherShortBiasMul: 0.7,
    },
    /** Outfielder slack (sec) deciding how aggressively the runner takes
     *  an extra base. Smaller slack ⇒ more doubles/triples. */
    extraBaseSlackSec: {
      /** Used in single-vs-double decision (throw to 2B). 0 = neutral;
       *  doubles emerge from balls landing in the gap or rolling past the OF,
       *  not from a hard-coded aggression bias. */
      toSecond: 0.0,
      /** Used in double-vs-triple decision (throw to 3B). 0 = neutral;
       *  triples emerge organically from corner caroms / wall bounces /
       *  long OF chases, not from a slack handout. */
      toThird: 0.0,
    },
  },

  // ─── Batted-ball distributions ────────────────────────────────
  // Skill→tendency mapping. These are the v1 levers.
  battedBall: {
    // ─── Statcast collision model (Phase 4) ─────────────────────
    // V_exit = q × V_pitch + (1+q) × V_bat
    collisionEfficiency: 0.2,           // q — wood bat COR
    batSpeedBaseMph: 60,                // Power 0 bat speed
    batSpeedRangeMph: 22,               // additional mph over Power 1-10

    // Legacy: kept for analytics/parity checking only
    powerToExitVeloMph: { min: 67, max: 106 },

    // Launch angle bias by dhr skill: 1=worm-burner, 10=uppercut.
    // Round bat + round ball can produce -25° to +70° in real baseball.
    // DHR 1 = chopper/worm-burner, DHR 10 = uppercut fly-ball hitter.
    dhrToLaunchAngleDeg: { min: -10, max: 30 },
    launchAngleStdDevDeg: 16,    // wider spread → more fly balls + pop-ups
    exitVeloStdDevMph: 8,
    /** Height of the bat at contact (feet). All balls launch from this
     *  height, not from the ground. A 0° LA ball from 3 ft travels ~55 ft
     *  before touching grass — a screaming one-hopper, not a worm-burner.
     *  Negative LA balls chop into the dirt quickly. This eliminates the
     *  hard 5° grounder cutoff in favor of physics-based ground contact. */
    contactHeightFt: 3,
    // Spray angle convention: 0° = dead CF, -45° = LF foul line, +45° = RF.
    // RHB pulls to -pullCenterDeg, LHB to +pullCenterDeg. StdDev keeps most
    // contact inside the fair wedge while still allowing oppo-field hits.
    pullCenterDeg: 14,
    sprayStdDevDeg: 18,
  },

  // ─── Pitch-by-pitch outcome rolls ─────────────────────────────
  pitch: {
    baseInZoneRate: 0.50,        // pitcher's intent translation
    baseSwingInZoneRate: 0.72,
    baseChaseRate: 0.22,
    baseContactRate: 0.82,       // when swinging (modern MLB avg ~80-83%)
    foulRate: 0.52,               // ~52% of contact becomes foul
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
    // Sac-fly tag-ups are now PI/speed/depth/arm-gated in
    // defense/decide.ts (`decideTagUpSacFly`), not a flat probability.
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
  // Previous (pre-2026-05-06 recalibration) ranges for reference:
  // bbPct [0.07, 0.11]
  // kPct [0.18, 0.26]
  // babip [0.290, 0.310]
  // hrPerFb [0.10, 0.14]
  // pitchesPerPa [3.6, 4.0]
  // pitchesPerGame [135, 160]
  // runsPerGame [3.5, 5.5]
  // foulsPerPa [1.2, 1.8]
  expectedRanges: {
    bbPct:        [0.065, 0.095],
    kPct:         [0.220, 0.275],
    babip:        [0.345, 0.385],
    hrPerFb:      [0.10, 0.14],
    pitchesPerPa: [3.80, 4.10],
    pitchesPerGame: [152, 172],  // per team
    runsPerGame:  [4.20, 5.60],  // per team
    foulsPerPa:   [0.90, 1.10],
    foulPerContact: [0.54, 0.66],
  },
} as const;

export type Position = 'P' | 'C' | 'B1' | 'B2' | 'SS' | 'B3' | 'LF' | 'CF' | 'RF';
export const POSITIONS: Position[] = ['P', 'C', 'B1', 'B2', 'SS', 'B3', 'LF', 'CF', 'RF'];
