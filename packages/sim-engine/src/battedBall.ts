/**
 * Batted-ball resolution. Uses physics + fielder positions to decide
 * what happens when a hitter makes contact.
 *
 * Pipeline:
 *   1. Roll (EV, LA, SA) from hitter skills + handedness + pitcher.
 *   2. Compute flight (distance, hangTime, landing, foul, HR).
 *   3. If foul/HR — short-circuit.
 *   4. Find converging fielder; if catchable → out (FO/LO/PO).
 *   5. Ball lands → fielder picks up, throws to a base; race vs runner.
 *   6. Runner result → 1B/2B/3B (no extra-base aggression yet in v1).
 */
import type { Player, BattedBall, AtBatResult } from './types';
import type { Position } from './config';
import { CONFIG } from './config';
import { flight } from './physics/ballFlight';
import { FIELDER_POSITIONS_FT } from './physics/positions';
import { throwTimeSec } from './physics/throw';
import { runnerTimeSec, BASE_COORDS_FT, type BaseName } from './physics/speed';
import type { Rng } from './rng';

// ─── Step 1: Generate batted ball from skills ──────────────────
export function rollBattedBall(
  hitter: Player,
  pitcher: Player,
  rng: Rng,  opts: { forceFoul?: boolean } = {},): BattedBall {
  const cfg = CONFIG.battedBall;
  const { powerToExitVeloMph, dhrToLaunchAngleDeg, exitVeloStdDevMph,
    launchAngleStdDevDeg, pullCenterDeg, sprayStdDevDeg } = cfg;

  // Exit velo from hitter power, suppressed by pitcher power
  const evMin = powerToExitVeloMph.min;
  const evMax = powerToExitVeloMph.max;
  const tPow = (hitter.skills.power - 1) / 9;
  let evMean = evMin + tPow * (evMax - evMin);
  evMean -= (pitcher.skills.power - 5) * 0.8;  // pitcher power suppresses
  // Contact quality: high-avg hitters square the ball up more often (±3 mph)
  evMean += (hitter.skills.avg - 5) * 0.6;
  // Pitcher pitchIntel disrupts contact quality (−2 mph at skill 9)
  evMean -= (pitcher.skills.pitchIntel - 5) * 0.5;
  const exitVeloMph = Math.max(50, Math.min(120,
    rng.gaussian(evMean, exitVeloStdDevMph)));

  // Launch angle from dhr (low = grounders, high = uppercut)
  const laMin = dhrToLaunchAngleDeg.min;
  const laMax = dhrToLaunchAngleDeg.max;
  const tDhr = (hitter.skills.dhr - 1) / 9;
  const laMean = laMin + tDhr * (laMax - laMin);
  const launchAngleDeg = Math.max(-15, Math.min(60,
    rng.gaussian(laMean, launchAngleStdDevDeg)));

  // Spray: pull-side bias by handedness.
  // Convention: 0° = dead CF, -45° = LF foul line, +45° = RF foul line.
  // RHB pulls toward LF (negative spray); LHB pulls toward RF (positive).
  const pullBase = hitter.hand === 'L'
    ?  pullCenterDeg
    : -pullCenterDeg;
  let sprayAngleDeg = rng.gaussian(pullBase, sprayStdDevDeg);

  // Caller forced this contact to be foul (e.g. resolvePitch said
  // 'foul'). Push spray a few degrees past the nearest foul line so
  // the physics actually lands in foul territory but stays close to
  // the line — most fouls are line-drives or pop-ups near the bag.
  if (opts.forceFoul && sprayAngleDeg >= -45 && sprayAngleDeg <= 45) {
    const toLeft = sprayAngleDeg < 0;
    sprayAngleDeg = toLeft
      ? -45 - Math.abs(rng.gaussian(8, 6))   // LF foul side (< -45°)
      :  45 + Math.abs(rng.gaussian(8, 6));  // RF foul side (> +45°)
  }

  const f = flight({ exitVeloMph, launchAngleDeg, sprayAngleDeg });

  return {
    exitVeloMph,
    launchAngleDeg,
    sprayAngleDeg,
    distanceFt: f.distanceFt,
    hangTimeSec: f.hangTimeSec,
    peakHeightFt: f.peakHeightFt,
    landingPoint: f.landingPoint,
    restPoint: f.restPoint,
    rollDistanceFt: f.rollDistanceFt,
    landingSpeedFps: f.landingSpeedFps,
    wallHitPoint: f.wallHitPoint,
    wallBounceSpeedFps: f.wallBounceSpeedFps,
    isFoul: f.isFoul,
    isHomeRun: f.isHomeRun,
  };
}

// ─── Step 2: Find converging fielder ───────────────────────────
function distanceFt(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

interface Convergence {
  position: Position;
  fielder: Player;
  reachTimeSec: number;
  caught: boolean;
}

function findConverger(
  ball: BattedBall,
  defense: Map<Position, Player>,
): Convergence {
  const isGrounder = ball.launchAngleDeg < 5;
  // C and P field grounders, but they should also handle squibbers /
  // choppers / weak pop-ups that land in front of the plate even when
  // the launch angle technically reads above 5\u00b0. Otherwise an 8\u00b0
  // chopper that travels 12 ft gets given to the 3rd baseman 89 ft
  // away. Treat anything inside ~45 ft of home as "in front of the
  // plate" and let C/P compete for it.
  const distFromHome = Math.hypot(ball.landingPoint.x, ball.landingPoint.y);
  const isShortBall = distFromHome < CONFIG.fielding.shortBallRadiusFt;
  // Each fielder has a "natural" angular zone — the spray angle his
  // home position covers. Reaching outside that zone costs a small
  // territory penalty (CONFIG.fielding.territoryPenaltySecPerDeg) so the
  // right fielder doesn't routinely steal balls hit into the left
  // fielder's area when his speed/range edges out the geometric leader
  // by a hair. (Spray convention: 0 = CF, -45 = LF line, +45 = RF line.)
  const NATURAL_ANGLE = CONFIG.fielding.naturalSprayAngleDeg as Partial<Record<Position, number>>;
  const ballAngle = ball.sprayAngleDeg;
  let best: Convergence | null = null;
  for (const [pos, fielder] of defense) {
    // P and C only field grounders (comebackers, squibbers, bunts) or
    // anything that lands close to home plate (choppers, weak pop-ups).
    if ((pos === 'P' || pos === 'C') && !isGrounder && !isShortBall) continue;
    const fielderPt = FIELDER_POSITIONS_FT[pos];
    const dist = distanceFt(fielderPt, ball.landingPoint);
    // Defense leverage: skill 1 ≈ 14 ft/sec, skill 10 ≈ 44 ft/sec
    const range = CONFIG.fielder.rangeFtPerSec
      + (fielder.skills.defense - 5) * 4.0
      + (fielder.skills.speed - 5) * 1.0;
    let reach = CONFIG.fielder.reactionSec + dist / Math.max(12, range);
    // Direction-of-motion penalty: a fielder charging the ball (toward
    // home plate) sees it cleanly and runs at full range; a fielder
    // backpedaling toward the wall must turn his head, track the ball
    // over his shoulder, and physically can't run as fast. Modeled as
    // an effective-range multiplier based on the dot product between
    // his motion vector and the toward-home unit vector. Lateral motion
    // sits in between. Skipped for the catcher (always faces the ball)
    // and for grounders (no flight to track over the shoulder).
    if (!isGrounder && pos !== 'C' && pos !== 'P') {
      const fieldPtMag = Math.hypot(fielderPt.x, fielderPt.y);
      const motionDx = ball.landingPoint.x - fielderPt.x;
      const motionDy = ball.landingPoint.y - fielderPt.y;
      const motionMag = Math.hypot(motionDx, motionDy);
      if (fieldPtMag > 1 && motionMag > 1) {
        // Toward home unit vector from fielder is -fielderPt / |fielderPt|.
        const towardHomeX = -fielderPt.x / fieldPtMag;
        const towardHomeY = -fielderPt.y / fieldPtMag;
        const motionUx = motionDx / motionMag;
        const motionUy = motionDy / motionMag;
        // forwardness ∈ [-1, 1]: +1 charging home, -1 backpedaling.
        const forwardness = motionUx * towardHomeX + motionUy * towardHomeY;
        const norm = (forwardness + 1) / 2;  // [0, 1]
        const dirMul = CONFIG.fielding.backpedalMul
          + (CONFIG.fielding.chargeMul - CONFIG.fielding.backpedalMul) * norm;
        // Recompute reach with the direction-adjusted range. Reaction
        // time is unchanged — the penalty is on the run, not the read.
        reach = CONFIG.fielder.reactionSec
          + dist / Math.max(12, range * dirMul);
      }
    }
    // Territory penalty: 0.012s per degree away from this fielder's
    // home zone. A 20° miss costs 0.24s — enough to keep CF from
    // poaching a routine LF flyball but small enough that a clear
    // gap-shot still goes to whoever is geometrically closest.
    const natural = NATURAL_ANGLE[pos];
    if (natural !== undefined && !isGrounder) {
      reach += Math.abs(ballAngle - natural) * CONFIG.fielding.territoryPenaltySecPerDeg;
    }
    // Depth penalty: an infielder reaching for a ball that lands deep
    // in OF territory (e.g. SS at 130 ft chasing a 207 ft drive) gets
    // hammered by an extra `infielderDepthPenaltySecPerFt` per ft of
    // excess depth. Geometric closeness alone shouldn't let an IF
    // poach a play that any OF can comfortably make.
    const isIF = pos === 'B1' || pos === 'B2' || pos === 'SS' || pos === 'B3';
    if (isIF && !isGrounder) {
      const ballDepth = distFromHome;
      const excess = ballDepth - CONFIG.fielding.infielderMaxNaturalDepthFt;
      if (excess > 0) {
        reach += excess * CONFIG.fielding.infielderDepthPenaltySecPerFt;
      }
    }
    // Catch radius scales with defense (±6 ft across 1-10).
    const effectiveCatchRadius = CONFIG.fielder.catchRadiusFt
      + (fielder.skills.defense - 5) * 1.5;
    // Hangtime tolerance: fielder must basically arrive coincident with
    // the ball. Slack 0 = league-average catch rate; positive slack
    // would let blooper-singles get caught.
    const caught = !isGrounder
      && (reach <= ball.hangTimeSec || dist <= effectiveCatchRadius + 4);
    if (!best || reach < best.reachTimeSec) {
      best = { position: pos, fielder, reachTimeSec: reach, caught };
    }
  }
  // For very weak grounders, prefer infielder closest to ball
  // (the loop above already considers all of them, so `best` is correct).
  // `defense` is invariantly the 9 starters — the loop always assigns
  // best at least once. Throw on the impossible empty case so callers
  // never receive an undefined Convergence.
  if (!best) throw new Error('findConverger: no fielders in defense map');
  return best;
}

// ─── Step 3: Resolve full batted-ball outcome ──────────────────
export interface BattedBallResolution {
  result: AtBatResult;
  fieldedBy?: Position;  /** When `result === 'reached-on-error'`, distinguishes whether the
   *  fielder muffed the ball ('fielding') or made a wild throw
   *  ('throw'). Throw errors let existing runners take an extra base. */
  errorType?: 'fielding' | 'throw';}

export function resolveBattedBall(
  ball: BattedBall,
  hitter: Player,
  defense: Map<Position, Player>,
  rng: Rng,
): BattedBallResolution {
  if (ball.isHomeRun) return { result: 'home-run' };

  // Foul balls are handled upstream in atBat.ts via `resolveFoulBall`
  // (which decides whether the foul is caught for an out). By the time a
  // ball reaches `resolveBattedBall`, it should be fair — guard anyway.
  if (ball.isFoul) return { result: 'foul-out' };

  const conv = findConverger(ball, defense);
  const isGrounder = ball.launchAngleDeg < 5;

  // For grounders, the ball is intercepted along its path by the closest
  // infielder — record where the IF actually gloves it so visuals +
  // throw geometry reflect that. We do NOT overwrite `landingPoint` /
  // `distanceFt`: those describe the ball's natural physics and the
  // hit-classifier (single vs double vs triple) reads them. Decoupling
  // these two concepts is what keeps BABIP from collapsing.
  if (isGrounder) {
    const fielderPt = FIELDER_POSITIONS_FT[conv.position];
    const isOF = conv.position === 'LF' || conv.position === 'CF' || conv.position === 'RF';
    if (!isOF) {
      // Project the fielder's position onto the ball's path (origin -> landing).
      const pathDx = ball.landingPoint.x;
      const pathDy = ball.landingPoint.y;
      const pathLen2 = pathDx * pathDx + pathDy * pathDy;
      if (pathLen2 > 1) {
        const dot = (fielderPt.x * pathDx + fielderPt.y * pathDy) / pathLen2;
        // Only mark an intercept when the fielder is genuinely in front
        // of the ball's natural landing (dot < 1). Past-the-fielder balls
        // keep their natural landingPoint so OF takes over.
        if (dot > 0 && dot < 1) {
          ball.fieldedAtPoint = {
            x: pathDx * dot,
            y: pathDy * dot,
          };
        }
      }
    }
  }

  // Fielding error roll: low-defense fielders muff the ball outright.
  // (Throw errors are a separate roll below — only IFs that have to
  // make the cross-diamond throw can wild-throw it.)
  const errorBase = isGrounder
    ? CONFIG.errors.grounderErrorBase
    : CONFIG.errors.flyErrorBase;
  const fieldErrorChance = Math.max(0,
    errorBase + (5 - conv.fielder.skills.defense) * CONFIG.errors.skillLeverage);
  const isFieldError = rng.bool(fieldErrorChance);

  // Caught in air → fly/line/pop out (unless dropped on error)
  if (conv.caught && !isFieldError) {
    if (ball.launchAngleDeg < 10)  return { result: 'line-out',  fieldedBy: conv.position };
    if (ball.launchAngleDeg > 50)  return { result: 'pop-out',   fieldedBy: conv.position };
    return { result: 'fly-out', fieldedBy: conv.position };
  }
  if (conv.caught && isFieldError) {
    // Dropped fly: batter reaches safely (charged as fielding error)
    return { result: 'reached-on-error', fieldedBy: conv.position, errorType: 'fielding' };
  }

  // Ball drops / rolls. For grounders, ball travels to fielder; for flies
  // that aren't caught, the ball lands at `landingPoint` and then keeps
  // rolling along its spray vector toward `restPoint`. The fielder must
  // intercept somewhere along that roll path — so the OF reach time
  // becomes "how long until I'm standing where the ball is", not just
  // "how long until I reach the landing spot".
  const fielderPt = FIELDER_POSITIONS_FT[conv.position];
  const isOutfielder = conv.position === 'LF' || conv.position === 'CF' || conv.position === 'RF';
  const isInfielder = !isOutfielder;

  // ─── Solve OF intercept along the post-landing roll ─────────────
  // Fixed-point iteration: start by assuming the fielder reaches the
  // landing point at his computed reachTime; if the ball has already
  // rolled past by then, recompute his reach time to that new point;
  // converges in 3-5 passes. Skipped for grounders (no separate roll
  // segment) and HRs (left the field).
  let interceptPoint: { x: number; y: number } = ball.landingPoint;
  let totalToBall: number;
  if (isGrounder) {
    const ballRollSpeedFps = ball.exitVeloMph * CONFIG.flight.mphToFps
      * CONFIG.fielding.groundBallFrictionMul;
    const distToFielder = Math.hypot(
      fielderPt.x - ball.landingPoint.x,
      fielderPt.y - ball.landingPoint.y,
    );
    const ballTravelSec = CONFIG.fielder.reactionSec + distToFielder
      / Math.max(CONFIG.fielding.minRollSpeedFps, ballRollSpeedFps);
    totalToBall = ballTravelSec + CONFIG.fielding.pickupSec;
  } else {
    // Roll path & physics. With a wall ricochet, the ball traces out
    // along the spray vector to the wall, then bounces back toward
    // the infield with `wallBounceSpeedFps`. Position-along-spray is
    // therefore non-monotonic; the OF must be intercepted by total
    // GROUND covered `g ∈ [0, rollDistanceFt]`, not by displacement.
    const decel = CONFIG.flight.roll.grassDecelFtPerSec2;
    const vLand = ball.landingSpeedFps;
    const totalRoll = ball.rollDistanceFt;
    // Unit spray vector (from home through landing).
    const lpLen = Math.hypot(ball.landingPoint.x, ball.landingPoint.y);
    const ux = lpLen > 0 ? ball.landingPoint.x / lpLen : 0;
    const uy = lpLen > 0 ? ball.landingPoint.y / lpLen : 1;
    const wallHit = ball.wallHitPoint;
    const roomToWall = wallHit
      ? Math.hypot(wallHit.x - ball.landingPoint.x, wallHit.y - ball.landingPoint.y)
      : Infinity;
    const vBounce = ball.wallBounceSpeedFps ?? 0;
    // Time the ball reaches `g` ft of total ground covered (since landing).
    const tBallAtG = (g: number): number => {
      if (g <= roomToWall || !wallHit) {
        const disc = vLand * vLand - 2 * decel * g;
        const tau = disc > 0 ? (vLand - Math.sqrt(disc)) / decel
                             : (totalRoll > 0 ? totalRoll / Math.max(1, vLand * 0.5) : 0);
        return ball.hangTimeSec + tau;
      }
      // Past the wall: ball is on its way back.
      const tWall = (vLand - Math.sqrt(Math.max(0, vLand * vLand - 2 * decel * roomToWall))) / decel;
      const bs = g - roomToWall;
      const discB = vBounce * vBounce - 2 * decel * bs;
      const tauBack = discB > 0 ? (vBounce - Math.sqrt(discB)) / decel
                                : Infinity;
      return ball.hangTimeSec + tWall + tauBack;
    };
    // Where the ball is at `g` ft covered.
    const ballPosAtG = (g: number): { x: number; y: number } => {
      if (g <= roomToWall || !wallHit) {
        return {
          x: ball.landingPoint.x + ux * g,
          y: ball.landingPoint.y + uy * g,
        };
      }
      const back = g - roomToWall;
      return {
        x: wallHit.x - ux * back,
        y: wallHit.y - uy * back,
      };
    };
    // How much ground has the ball covered by time `t`?
    const gAtT = (t: number): number => {
      const tau = Math.max(0, t - ball.hangTimeSec);
      // Outbound segment.
      const gOut = Math.min(roomToWall, vLand * tau - 0.5 * decel * tau * tau);
      if (!wallHit || gOut < roomToWall) {
        return Math.max(0, Math.min(totalRoll, gOut));
      }
      // Reached wall — compute time spent outbound, then bounce back.
      const tWall = (vLand - Math.sqrt(Math.max(0, vLand * vLand - 2 * decel * roomToWall))) / decel;
      const tauBack = Math.max(0, tau - tWall);
      const gBack = vBounce * tauBack - 0.5 * decel * tauBack * tauBack;
      return Math.max(0, Math.min(totalRoll, roomToWall + Math.max(0, gBack)));
    };
    // Fielder range (ft/sec), same model as findConverger.
    const range = CONFIG.fielder.rangeFtPerSec
      + (conv.fielder.skills.defense - 5) * 4.0
      + (conv.fielder.skills.speed - 5) * 1.0;
    const effRange = Math.max(12, range);
    // Fixed-point intercept search, parameterized by total ground `g`.
    let g = 0;
    let T = conv.reachTimeSec;
    for (let i = 0; i < CONFIG.flight.roll.pursuitIterations; i++) {
      const tBall = tBallAtG(g);
      const p = ballPosAtG(g);
      const dist = Math.hypot(fielderPt.x - p.x, fielderPt.y - p.y);
      const tFielder = CONFIG.fielder.reactionSec + dist / effRange;
      const tMeet = Math.max(tBall, tFielder);
      // How far the ball rolled by the time the fielder reached the
      // most-recent guess: re-derive `g` from when the fielder gets
      // there. Damp for stability.
      const gNew = gAtT(tFielder);
      g = 0.6 * gNew + 0.4 * g;
      T = tMeet;
      // Early-out: if the fielder is camping at the landing point
      // before the ball even gets there, the intercept is landing.
      const fielderArrivalAtLanding = CONFIG.fielder.reactionSec
        + Math.hypot(fielderPt.x - ball.landingPoint.x,
                     fielderPt.y - ball.landingPoint.y) / effRange;
      if (fielderArrivalAtLanding <= ball.hangTimeSec) {
        g = 0;
        T = ball.hangTimeSec;
        break;
      }
    }
    // Final intercept point along the (possibly piecewise) roll path.
    interceptPoint = ballPosAtG(g);
    totalToBall = T + CONFIG.fielding.pickupSec;
    // Record where the fielder actually gloved it (drives visualizer +
    // throw geometry). For grounders this is set earlier in the
    // intercept-projection block; here we set it for non-caught flies.
    ball.fieldedAtPoint = interceptPoint;
    ball.fieldedAtSec = T;
  }

  if (isInfielder) {
    // Throw to 1B; race vs batter (or error → reached safely)
    if (isGrounder && isFieldError) {
      return { result: 'reached-on-error', fieldedBy: conv.position, errorType: 'fielding' };
    }
    // Cleanly fielded — now roll for an accurate throw. Wild throws
    // (airmail, one-hop, pulled cover off the bag) are charged as a
    // separate error type and let existing runners take an extra base.
    const throwErrorChance = Math.max(0,
      CONFIG.errors.throwErrorBase
        + (5 - conv.fielder.skills.defense) * CONFIG.errors.skillLeverage);
    if (rng.bool(throwErrorChance)) {
      return { result: 'reached-on-error', fieldedBy: conv.position, errorType: 'throw' };
    }
    const throwSec = throwTimeSec(fielderPt, BASE_COORDS_FT.first,
      conv.position, conv.fielder.skills.defense);
    const fielderArrival = totalToBall + throwSec;
    const runnerArrival = runnerTimeSec('home', 'first', hitter.skills.speed,
      { fromContact: true, hand: hitter.hand });
    if (fielderArrival < runnerArrival) {
      return { result: 'ground-out', fieldedBy: conv.position };
    }
    // Beat-out infield single
    return { result: 'single', fieldedBy: conv.position };
  }

  // Outfielder fielded — base hit. How many bases?
  // Throw to 2B to hold runner. The slack here decides single vs double:
  // smaller slack means more aggressive baserunning + more doubles. Real
  // MLB ≈ 1.5 doubles/team-game; the +0.5 slack used to make every OF
  // hit a single because fielders are aligned with the fair wedge under
  // the symmetric spray convention.
  const throwTo2 = throwTimeSec(fielderPt, BASE_COORDS_FT.second,
    conv.position, conv.fielder.skills.defense);
  const runnerToSecond = runnerTimeSec('home', 'first', hitter.skills.speed,
    { fromContact: true, hand: hitter.hand })
    + runnerTimeSec('first', 'second', hitter.skills.speed);
  const fielderToSecond = totalToBall + throwTo2;

  if (runnerToSecond > fielderToSecond - CONFIG.fielding.extraBaseSlackSec.toSecond) {
    // Runner wisely stops at first
    return { result: 'single', fieldedBy: conv.position };
  }

  // Runner could try for 2B. Try 3B too?
  const throwTo3 = throwTimeSec(fielderPt, BASE_COORDS_FT.third,
    conv.position, conv.fielder.skills.defense);
  const runnerToThird = runnerToSecond
    + runnerTimeSec('second', 'third', hitter.skills.speed);
  const fielderToThird = totalToBall + throwTo3;

  if (runnerToThird < fielderToThird - CONFIG.fielding.extraBaseSlackSec.toThird) {
    return { result: 'triple', fieldedBy: conv.position };
  }
  return { result: 'double', fieldedBy: conv.position };
}

/**
 * Decide whether a foul ball can be caught for an out. Real-world foul-
 * outs are rare (~0.3 per team-game, mostly catcher pop-ups + corner IF
 * down-the-line cans-of-corn). To stay near that rate we require:
 *   • A high pop-up (LA > 40°) — line-drive fouls into the seats are
 *     unplayable; routine fly fouls into the corner already curve out
 *     of bounds before a fielder can get there.
 *   • Landing within ~35 ft of one of the corner-IF / catcher / corner-OF
 *     fielders (`foulTerritoryDepthFt` is the league-wide ceiling; we
 *     use a smaller working radius).
 *   • The fielder can reach the spot before the ball comes down.
 *
 * Returns the catching fielder's position, or null if uncatchable.
 */
export function resolveFoulBall(
  ball: BattedBall,
  defense: Map<Position, Player>,
): { position: Position } | null {
  // Only true pop-ups can be run down in foul territory.
  if (ball.launchAngleDeg < 40) return null;

  // Working radius: tighter than the league cap so we don't over-produce
  // foul-outs. The cap in CONFIG is the absolute max a fielder will drift.
  const depthCap = Math.min(
    CONFIG.fielding.foulCatch.cornerDepthFt,
    CONFIG.park.foulTerritoryDepthFt,
  );
  // Catcher gets a wider chase radius for fouls in the dirt circle.
  // Real-life catchers will drift 50+ ft to track a foul pop.
  const catcherDepthCap = CONFIG.fielding.foulCatch.catcherDepthFt;
  let best: { pos: Position; reach: number } | null = null;
  for (const [pos, fielder] of defense) {
    // Only the corner infielders, catcher, and corner outfielders
    // typically chase fouls. Middle IFs / CF / pitcher stay home.
    if (pos === 'B2' || pos === 'SS' || pos === 'CF' || pos === 'P') continue;
    const fielderPt = FIELDER_POSITIONS_FT[pos];
    const dist = Math.hypot(
      fielderPt.x - ball.landingPoint.x,
      fielderPt.y - ball.landingPoint.y,
    );
    const cap = pos === 'C' ? catcherDepthCap : depthCap;
    if (dist > cap) continue;
    const range = CONFIG.fielder.rangeFtPerSec
      + (fielder.skills.defense - 5) * 4.0
      + (fielder.skills.speed - 5) * 1.0;
    const reach = CONFIG.fielder.reactionSec + dist / Math.max(12, range);
    // Need to get there before the ball comes down (no slack — fouls
    // drift unpredictably and most "close" fouls drop in the seats).
    if (reach > ball.hangTimeSec) continue;
    // Slight bias toward the catcher for short fouls (within the
    // configured radius of home), since C is best-positioned to read
    // pop-ups behind the plate.
    const reachAdj = pos === 'C'
      && Math.hypot(ball.landingPoint.x, ball.landingPoint.y) < CONFIG.fielding.foulCatch.catcherShortRadiusFt
      ? reach * CONFIG.fielding.foulCatch.catcherShortBiasMul
      : reach;
    if (!best || reachAdj < best.reach) {
      best = { pos, reach: reachAdj };
    }
  }
  return best ? { position: best.pos } : null;
}

