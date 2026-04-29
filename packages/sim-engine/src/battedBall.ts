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

  // Spray: pull-side bias by handedness
  // Lefty pulls toward RF (90°), righty pulls toward LF (0°)
  const pullBase = hitter.hand === 'L'
    ? 90 - pullCenterDeg
    : pullCenterDeg;
  let sprayAngleDeg = rng.gaussian(pullBase, sprayStdDevDeg);

  // Caller forced this contact to be foul (e.g. resolvePitch said
  // 'foul'). Push spray a few degrees past the nearest foul line so
  // the physics actually lands in foul territory but stays close to
  // the line — most fouls are line-drives or pop-ups near the bag.
  if (opts.forceFoul && sprayAngleDeg >= 0 && sprayAngleDeg <= 90) {
    const toLeft = sprayAngleDeg < 45;
    sprayAngleDeg = toLeft
      ? -Math.abs(rng.gaussian(8, 6))    // LF foul side
      : 90 + Math.abs(rng.gaussian(8, 6)); // RF foul side
  }

  const f = flight({ exitVeloMph, launchAngleDeg, sprayAngleDeg });

  return {
    exitVeloMph,
    launchAngleDeg,
    sprayAngleDeg,
    distanceFt: f.distanceFt,
    hangTimeSec: f.hangTimeSec,
    landingPoint: f.landingPoint,
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
  let best: Convergence | null = null;
  for (const [pos, fielder] of defense) {
    // P and C only field grounders (comebackers, squibbers, bunts).
    if ((pos === 'P' || pos === 'C') && !isGrounder) continue;
    const fielderPt = FIELDER_POSITIONS_FT[pos];
    const dist = distanceFt(fielderPt, ball.landingPoint);
    // Defense leverage: skill 1 ≈ 14 ft/sec, skill 10 ≈ 44 ft/sec
    const range = CONFIG.fielder.rangeFtPerSec
      + (fielder.skills.defense - 5) * 4.0
      + (fielder.skills.speed - 5) * 1.0;
    const reach = CONFIG.fielder.reactionSec + dist / Math.max(12, range);
    // Catch radius scales with defense (±6 ft across 1-10).
    const effectiveCatchRadius = CONFIG.fielder.catchRadiusFt
      + (fielder.skills.defense - 5) * 1.5;
    const caught = !isGrounder
      && (reach <= ball.hangTimeSec + 0.2 || dist <= effectiveCatchRadius + 4);
    if (!best || reach < best.reachTimeSec) {
      best = { position: pos, fielder, reachTimeSec: reach, caught };
    }
  }
  // For very weak grounders, prefer infielder closest to ball
  // (the loop above already considers all of them, so `best` is correct)
  return best!;
}

// ─── Step 3: Resolve full batted-ball outcome ──────────────────
export interface BattedBallResolution {
  result: AtBatResult;
  fieldedBy?: Position;
}

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

  // Error roll: low-defense fielders muff the play. Errors only on routine
  // chances (caught flies & playable grounders). Skill 1 misplays often;
  // skill 9 almost never.
  const errorBase = isGrounder
    ? CONFIG.errors.grounderErrorBase
    : CONFIG.errors.flyErrorBase;
  const errorChance = Math.max(0,
    errorBase + (5 - conv.fielder.skills.defense) * CONFIG.errors.skillLeverage);
  const isError = rng.bool(errorChance);

  // Caught in air → fly/line/pop out (unless dropped on error)
  if (conv.caught && !isError) {
    if (ball.launchAngleDeg < 10)  return { result: 'line-out',  fieldedBy: conv.position };
    if (ball.launchAngleDeg > 50)  return { result: 'pop-out',   fieldedBy: conv.position };
    return { result: 'fly-out', fieldedBy: conv.position };
  }
  if (conv.caught && isError) {
    // Dropped fly: batter reaches safely
    return { result: 'reached-on-error', fieldedBy: conv.position };
  }

  // Ball drops / rolls. For grounders, ball travels to fielder; for flies
  // that aren't caught, fielder ran to landing point.
  const fielderPt = FIELDER_POSITIONS_FT[conv.position];
  const isOutfielder = conv.position === 'LF' || conv.position === 'CF' || conv.position === 'RF';
  const isInfielder = !isOutfielder;

  // Time the fielder takes to be "on the ball with glove on it":
  //   grounder → ball travels at ~50% of exit velo to him (rolling friction)
  //   fly      → use his computed reach time + glove pickup
  const ballRollSpeedFps = ball.exitVeloMph * CONFIG.flight.mphToFps * 0.55;
  const distToFielder = Math.hypot(
    fielderPt.x - ball.landingPoint.x,
    fielderPt.y - ball.landingPoint.y,
  );
  const ballTravelSec = isGrounder
    ? CONFIG.fielder.reactionSec + distToFielder / Math.max(40, ballRollSpeedFps)
    : conv.reachTimeSec;
  const pickupSec = 0.4;
  const totalToBall = ballTravelSec + pickupSec;

  if (isInfielder) {
    // Throw to 1B; race vs batter (or error → reached safely)
    if (isGrounder && isError) {
      return { result: 'reached-on-error', fieldedBy: conv.position };
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
  // Throw to 2B to hold runner.
  const throwTo2 = throwTimeSec(fielderPt, BASE_COORDS_FT.second,
    conv.position, conv.fielder.skills.defense);
  const runnerToSecond = runnerTimeSec('home', 'first', hitter.skills.speed,
    { fromContact: true, hand: hitter.hand })
    + runnerTimeSec('first', 'second', hitter.skills.speed);
  const fielderToSecond = totalToBall + throwTo2;

  if (runnerToSecond > fielderToSecond + 0.5) {
    // Runner wisely stops at first
    return { result: 'single', fieldedBy: conv.position };
  }

  // Runner could try for 2B. Try 3B too?
  const throwTo3 = throwTimeSec(fielderPt, BASE_COORDS_FT.third,
    conv.position, conv.fielder.skills.defense);
  const runnerToThird = runnerToSecond
    + runnerTimeSec('second', 'third', hitter.skills.speed);
  const fielderToThird = totalToBall + throwTo3;

  if (runnerToThird < fielderToThird - 0.3) {
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
  const depthCap = Math.min(35, CONFIG.park.foulTerritoryDepthFt);
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
    if (dist > depthCap) continue;
    const range = CONFIG.fielder.rangeFtPerSec
      + (fielder.skills.defense - 5) * 4.0
      + (fielder.skills.speed - 5) * 1.0;
    const reach = CONFIG.fielder.reactionSec + dist / Math.max(12, range);
    // Need to get there before the ball comes down (no slack — fouls
    // drift unpredictably and most "close" fouls drop in the seats).
    if (reach > ball.hangTimeSec) continue;
    if (!best || reach < best.reach) {
      best = { pos, reach };
    }
  }
  return best ? { position: best.pos } : null;
}

