// Last touched by agent: 2026-05-06T12:36:52Z
/**
 * Per-pitch batted-ball event emitter.
 *
 * Given a `BattedBall` and the at-bat that produced it, push the
 * `contact`, `fielder-converge`, optional `fielder-dive`, `cover-base`,
 * `throw`, and backup-fielder events that animate the play.
 *
 * Caller (`buildEvents`) handles the per-play ball-return to the
 * pitcher and the base-running.
 */
import type { AtBatRecord, BattedBall, Player } from '../types';
import type { Position } from '../config';
import { FIELDER_POSITIONS_FT } from '../physics/positions';
import { throwTimeSec } from '../physics/throw';
import { fielderReachTimeSec } from '../physics/speed';
import { getCoverage } from '../defense/responsibilities';
import { decideThrowTarget, type GameContext } from '../defense/decide';
import type { Rng } from '../rng';
import type { SimEventInit } from './types';
import { TIME, basePoint } from './timing';

export function emitBattedBallVisuals(
  ball: BattedBall,
  ab: AtBatRecord,
  push: (e: SimEventInit, dt: number) => void,
  defenseMap?: Map<Position, Player>,
  /** Pre-play base occupancy [r1, r2, r3]. Used by the coverage
   *  responsibility table to decide where the ball gets thrown.
   *  Optional for backwards compatibility — defaults to empty bases. */
  bases?: readonly (unknown | null)[],
  outsBefore = 0,
  /** Optional Rng for PI rolls on throw target. If omitted, the
   *  textbook coverage is used unconditionally (legacy behavior). */
  rng?: Rng,
  /** Phase 4: game-state context for score/inning-aware difficulty
   *  modifiers on the throw-home decision. */
  gameContext?: GameContext,
): void {
  // The play happens at `fieldedAtPoint` for grounders the IF intercepts
  // mid-roll; for everything else it's the ball's natural landing point.
  const playPoint = ball.fieldedAtPoint ?? ball.landingPoint;
  // For the visual `contact` tween we want the ball to fly along its
  // ACTUAL trajectory:
  //   • Caught flies / HRs / fouls   → playPoint (ball ends in glove
  //                                    or beyond the wall).
  //   • Grounders fielded by an IF   → playPoint (no separate ball-roll
  //                                    event is emitted for grounders;
  //                                    the contact tween IS the roll).
  //   • Uncaught fair flies / liners → landingPoint, and the subsequent
  //                                    `ball-roll` segment(s) carry it
  //                                    from landing to the fielder.
  // Sending an uncaught fly to playPoint would teleport it past the
  // landing spot mid-flight; sending a grounder to landingPoint would
  // overshoot the IF and then pop back when he throws to first.
  const isCaught = ['fly-out', 'line-out', 'pop-out', 'sac-fly'].includes(ab.result);
  const isGrounder = ball.hangTimeSec < 0.6 && ball.distanceFt < 90;
  const contactLanding = isCaught || ball.isHomeRun || ball.isFoul || isGrounder
    ? playPoint
    : ball.landingPoint;

  push({
    type: 'contact',
    exitVeloMph: ball.exitVeloMph,
    launchAngleDeg: ball.launchAngleDeg,
    sprayAngleDeg: ball.sprayAngleDeg,
    distanceFt: ball.distanceFt,
    hangTimeSec: ball.hangTimeSec,
    peakHeightFt: ball.peakHeightFt,
    landingPoint: contactLanding,
    isFoul: ball.isFoul,
    isHomeRun: ball.isHomeRun,
  }, 0);

  // Fielder converge/throw — only if a fielder was assigned
  if (!ab.fieldedBy) return;
  const fielderPt = FIELDER_POSITIONS_FT[ab.fieldedBy];
  const fielderPlayer = defenseMap?.get(ab.fieldedBy);
  // For caught flies, the fielder converges to the landing point at
  // hangtime. For balls that drop and roll, the engine resolved an
  // intercept time (`fieldedAtSec`) past hangtime — use it so the
  // converge animation tracks the chase along the roll path.
  const reachSec = ball.fieldedAtSec
    ?? ball.hangTimeSec
    ?? TIME.contactToFieldedDefault;

  // ─── Two-phase converge for balls that drop fair ──────────────
  // On a double/triple, the fielder should NOT run directly to the
  // final fielded point — that makes them look like they're "on the
  // ball" the whole time. Instead:
  //   Phase 1: sprint toward the LANDING point (where the ball drops)
  //   Phase 2: redirect to chase the ball to where they pick it up
  //
  // This creates the visual of the ball getting past the fielder:
  // the ball lands, bounces past, and the fielder turns to chase.
  //
  // For caught flies, keep the single converge to playPoint (the
  // fielder catches it where it lands).
  const isOFPlay = ['LF', 'CF', 'RF'].includes(ab.fieldedBy);
  const ballDropped = !isCaught && isOFPlay
    && ball.fieldedAtPoint
    && ball.landingPoint
    && Math.hypot(
      ball.fieldedAtPoint.x - ball.landingPoint.x,
      ball.fieldedAtPoint.y - ball.landingPoint.y,
    ) > 15;  // significant roll distance (>15 ft) = ball got past
  if (ballDropped) {
    // Phase 1: sprint toward landing point at full speed.
    // The fielder reaches this area around hangTime (or a bit after
    // if they're slow — they never quite get there in time).
    const phase1Sec = Math.min(reachSec, ball.hangTimeSec + 0.3);
    push({
      type: 'fielder-converge',
      position: ab.fieldedBy,
      playerId: fielderPlayer?.id ?? -1,
      fromPoint: fielderPt,
      toPoint: ball.landingPoint,
      reachSec: phase1Sec,
      role: 'chase',
    }, 0);
    // Phase 2: redirect toward the fielded point (ball-chase).
    // This fires after Phase 1 completes, creating the visible
    // turn-and-chase that makes doubles look realistic.
    const phase2Sec = Math.max(0.4, reachSec - phase1Sec);
    push({
      type: 'fielder-converge',
      position: ab.fieldedBy,
      playerId: fielderPlayer?.id ?? -1,
      fromPoint: ball.landingPoint,
      toPoint: playPoint,
      reachSec: phase2Sec,
      role: 'primary',
    }, phase1Sec);
  } else {
    // Caught fly / grounder / short roll — single converge is fine.
    push({
      type: 'fielder-converge',
      position: ab.fieldedBy,
      playerId: fielderPlayer?.id ?? -1,
      fromPoint: fielderPt,
      toPoint: playPoint,
      reachSec,
      role: 'primary',
    }, 0);
  }

  // Phase 5.16: dive/leap when the converge is tight against hangtime.
  // We treat reach within 0.25s of hangtime as "diving" effort. Leap is
  // reserved for line drives / low flies fielded by an OF (high catch).
  if (ball.hangTimeSec > 0.4 && Math.abs(reachSec - ball.hangTimeSec) < 0.25) {
    const isOF = ['LF', 'CF', 'RF'].includes(ab.fieldedBy);
    const isLineLike = ball.launchAngleDeg < 18;
    const variant: 'dive' | 'leap' = isOF && !isLineLike ? 'leap' : 'dive';
    const successful = ['fly-out', 'line-out', 'pop-out', 'sac-fly'].includes(ab.result);
    // If the two-phase converge already advanced the clock by phase1Sec,
    // subtract it so the dive fires at the correct absolute time.
    const diveDelay = ballDropped
      ? Math.max(0, reachSec - (ball.hangTimeSec + 0.3))
      : reachSec;
    push({
      type: 'fielder-dive',
      position: ab.fieldedBy,
      playerId: fielderPlayer?.id ?? -1,
      atPoint: playPoint,
      variant,
      successful,
    }, diveDelay);
  }

  // Infielder throw to 1B for ground-outs / FCs
  const isInfielder = !['LF', 'CF', 'RF'].includes(ab.fieldedBy);

  // ─── Ball-roll segment(s) (post-landing) ─────────────────────
  // For fly balls that drop fair and aren't caught, the ball bounces
  // and rolls from `landingPoint` toward the fielder's intercept point
  // (already resolved into `ab.battedBall.fieldedAtPoint` by the
  // engine). Emit a `ball-roll` so the renderer tweens the ball along
  // the grass instead of stopping it dead at the landing spot.
  //
  // If the engine recorded a `wallHitPoint` AND the fielder didn't
  // glove the ball before it reached the wall, we emit TWO segments
  // (landing → wall, then wall → fieldedAt) so the visual ricochet is
  // explicit. The fielder will catch up to the ball on the rebound.
  //
  // Skipped for: grounders (continuous trajectory; no separate landing
  // beat in the visual), HRs (left the field), foul-outs (caught in
  // the air), and any caught-fly result.
  const isGrounderVisual = ball.hangTimeSec < 0.6 && ball.distanceFt < 90;
  if (!isCaught && !isGrounderVisual && !ball.isHomeRun && !ball.isFoul
    && ball.fieldedAtPoint) {
    const wallHit = ball.wallHitPoint;
    // Did the fielder catch the ball before the wall? Compare cumulative
    // ground from landing to fieldedAt vs landing to wall. If wallHit
    // exists and the fielder gloved the ball at distance > roomToWall
    // along the spray, OR after the bounce point, animate the ricochet.
    const fieldedDispFt = Math.hypot(
      ball.fieldedAtPoint.x - ball.landingPoint.x,
      ball.fieldedAtPoint.y - ball.landingPoint.y,
    );
    const roomToWall = wallHit ? Math.hypot(
      wallHit.x - ball.landingPoint.x,
      wallHit.y - ball.landingPoint.y,
    ) : Infinity;
    // Detect "fielded after the bounce": the intercept point lies on
    // the back-toward-infield half of the path (closer to home than
    // the wall) AND a wallHitPoint was recorded.
    const fieldedDistFromHome = Math.hypot(ball.fieldedAtPoint.x, ball.fieldedAtPoint.y);
    const wallDistFromHome = wallHit ? Math.hypot(wallHit.x, wallHit.y) : 0;
    const bounced = !!wallHit && fieldedDistFromHome < wallDistFromHome - 1;

    if (bounced && wallHit) {
      // Two-segment animation: out to wall, then ricochet back to glove.
      const decel = 14; // matches CONFIG.flight.roll.grassDecelFtPerSec2
      const vLand = ball.landingSpeedFps;
      const vAtWall = Math.sqrt(Math.max(0, vLand * vLand - 2 * decel * roomToWall));
      const outAvg = Math.max(8, (vLand + vAtWall) / 2);
      const outSec = Math.max(0.15, roomToWall / outAvg);
      const backLen = Math.hypot(
        ball.fieldedAtPoint.x - wallHit.x,
        ball.fieldedAtPoint.y - wallHit.y,
      );
      const vBounce = ball.wallBounceSpeedFps ?? vAtWall * 0.55;
      const backAvg = Math.max(6, vBounce * 0.5);
      const backSec = Math.max(0.15, backLen / backAvg);
      push({
        type: 'ball-roll',
        fromPoint: ball.landingPoint,
        toPoint: wallHit,
        rollSec: outSec,
      }, ball.hangTimeSec);
      push({
        type: 'ball-roll',
        fromPoint: wallHit,
        toPoint: ball.fieldedAtPoint,
        rollSec: backSec,
      }, ball.hangTimeSec + outSec);
    } else if (fieldedDispFt > 1) {
      // Single segment: simple grass roll from landing to glove.
      const avgSpeed = Math.max(8, ball.landingSpeedFps * 0.5);
      const rollSec = Math.max(0.15, fieldedDispFt / avgSpeed);
      push({
        type: 'ball-roll',
        fromPoint: ball.landingPoint,
        toPoint: ball.fieldedAtPoint,
        rollSec,
      }, ball.hangTimeSec);
    }
  }

  // ─── Coverage / cutoff / backup positioning (Phase 2) ───
  // Driven by the deterministic responsibility table. Emit
  // cover/cutoff/backup converges in parallel with the throw so the
  // whole defense rotates correctly on every play.
  const coverage0 = getCoverage({
    fielder: ab.fieldedBy,
    fieldedAt: playPoint,
    result: ab.result,
    bases: bases ?? [null, null, null],
    outs: outsBefore,
    defenseLeadDeficit: gameContext?.defenseLeadDeficit,
    sprayAngleDeg: ball.sprayAngleDeg,
    batterHand: ab.batter.hand,
  });
  // PI gate: low-PI fielder may downgrade the throw target to a
  // safer base, conceding the lead runner. High-PI fielders execute
  // the textbook play almost every time. Pure replay-time roll
  // seeded from team ids in buildEvents — reproducible. Phase 4
  // adds score/inning-aware difficulty modifiers via gameContext.
  // Pass `bases` so the downgrade ladder skips occupied bases (e.g.
  // don't throw to 3B when 3B already has a runner).
  let coverage = coverage0;
  if (rng) {
    const piCoverage = decideThrowTarget(coverage0, fielderPlayer, rng, gameContext, bases ?? [null, null, null]);
    if (piCoverage.throwTarget !== coverage0.throwTarget) {
      // Target changed — regenerate full coverage (cutoff/cover/backup)
      // so positions line up correctly for the NEW throw line. Otherwise
      // the cutoff stands on the old (home) line while the throw actually
      // goes to third, visually splitting the relay in the wrong direction.
      coverage = getCoverage({
        fielder: ab.fieldedBy,
        fieldedAt: playPoint,
        result: ab.result,
        bases: bases ?? [null, null, null],
        outs: outsBefore,
        defenseLeadDeficit: gameContext?.defenseLeadDeficit,
        sprayAngleDeg: ball.sprayAngleDeg,
        batterHand: ab.batter.hand,
        forceTarget: piCoverage.throwTarget ?? undefined,
      });
    } else {
      coverage = piCoverage;
    }
  }

  // All cover / cutoff / backup fielders break at contact (dt=0). The
  // renderer tweens them to their assigned point. Travel time is computed
  // from actual distance and the player's speed skill — no more arbitrary
  // hangTime fractions that made players teleport.
  for (const c of coverage.covers) {
    const player = defenseMap?.get(c.position);
    const speed = player?.skills.speed ?? 5;
    const defense = player?.skills.fielding ?? 5;
    const travelSec = fielderReachTimeSec(
      FIELDER_POSITIONS_FT[c.position], c.toPoint, speed, defense,
    );
    push({
      type: 'cover-base',
      position: c.position,
      base: c.base,
      fromPoint: FIELDER_POSITIONS_FT[c.position],
      toPoint: c.toPoint,
      arriveSec: travelSec,
    }, 0);
  }
  // Track how long the cutoff man needs to reach the relay point —
  // the throw must wait until he's in position.
  let cutoffTravelSec = 0;
  if (coverage.cutoff) {
    const player = defenseMap?.get(coverage.cutoff.position);
    const speed = player?.skills.speed ?? 5;
    const defense = player?.skills.fielding ?? 5;
    cutoffTravelSec = fielderReachTimeSec(
      FIELDER_POSITIONS_FT[coverage.cutoff.position], coverage.cutoff.toPoint, speed, defense,
    );
    push({
      type: 'fielder-converge',
      position: coverage.cutoff.position,
      playerId: player?.id ?? -1,
      fromPoint: FIELDER_POSITIONS_FT[coverage.cutoff.position],
      toPoint: coverage.cutoff.toPoint,
      reachSec: cutoffTravelSec,
      role: 'cutoff',
    }, 0);
  }
  for (const bk of coverage.backups) {
    const player = defenseMap?.get(bk.position);
    const speed = player?.skills.speed ?? 5;
    const defense = player?.skills.fielding ?? 5;
    const travelSec = fielderReachTimeSec(
      FIELDER_POSITIONS_FT[bk.position], bk.toPoint, speed, defense,
    );
    push({
      type: 'fielder-converge',
      position: bk.position,
      playerId: player?.id ?? -1,
      fromPoint: FIELDER_POSITIONS_FT[bk.position],
      toPoint: bk.toPoint,
      reachSec: travelSec,
      role: 'backup',
    }, 0);
  }

  // ─── CF always converges as backup on any OF play ────────────
  // The center fielder takes priority and always helps — he breaks
  // toward the play point on any hit or out in the outfield, whether
  // he's the primary fielder or not. If CF IS the fielder, this is
  // already handled by the fielder-converge above. If CF is already
  // assigned as a cover/cutoff/backup, skip the duplicate.
  const cfAlreadyAssigned = ab.fieldedBy === 'CF'
    || coverage.covers.some(c => c.position === 'CF')
    || coverage.cutoff?.position === 'CF'
    || coverage.backups.some(b => b.position === 'CF');
  if (isOFPlay && !cfAlreadyAssigned) {
    // CF converges toward the play point (midway between his home
    // and the ball) to provide backup support.
    const cfHome = FIELDER_POSITIONS_FT.CF;
    const cfTarget = {
      x: (cfHome.x + playPoint.x) / 2,
      y: (cfHome.y + playPoint.y) / 2,
    };
    const cfPlayer = defenseMap?.get('CF');
    const cfSpeed = cfPlayer?.skills.speed ?? 5;
    const cfDef = cfPlayer?.skills.fielding ?? 5;
    const cfTravelSec = fielderReachTimeSec(cfHome, cfTarget, cfSpeed, cfDef);
    push({
      type: 'fielder-converge',
      position: 'CF',
      playerId: cfPlayer?.id ?? -1,
      fromPoint: cfHome,
      toPoint: cfTarget,
      reachSec: cfTravelSec,
      role: 'backup',
    }, 0);
  }

  // ─── Throws ───
  // Infield grounder/FC/DP throws keep the existing single-hop path
  // (the cover assignments above already supplied the receiver).
  // OF hits with a non-null cutoff get a TWO-hop relay: OF → cutoff,
  // then cutoff → final base.
  if (!isCaught && isInfielder) {
    const targetBase = ab.result === 'double-play' || ab.result === 'fielders-choice'
      ? 'second' as const
      : 'first' as const;
    const targetPt = basePoint(targetBase);
    const throwFlightSec = fielderPlayer
      ? throwTimeSec(playPoint, targetPt, ab.fieldedBy, fielderPlayer.skills.throwing)
      : TIME.throwToBaseSec;
    push({
      type: 'throw',
      fromPosition: ab.fieldedBy, fromPlayerId: fielderPlayer?.id ?? -1,
      fromPoint: playPoint,
      toBase: targetBase,
      toPoint: targetPt,
      flightSec: throwFlightSec,
    }, TIME.fieldedToThrowSec);

    // Double-play relay: pivot at 2B turns and throws to first for the
    // back-end out. Without this second throw the visualizer just shows
    // a force at second and the at-bat ends, even though the engine
    // booked two outs (e.g. 5-4-3, 6-4-3, 4-6-3, 1-4-3, 3-6-3).
    if (ab.result === 'double-play') {
      const pivotPos: Position = ab.fieldedBy === 'B2' ? 'SS'
        : ab.fieldedBy === 'SS' ? 'B2'
          : ab.fieldedBy === 'B1' ? 'SS'
            : 'B2';
      const pivotPlayer = defenseMap?.get(pivotPos);
      const firstPt = basePoint('first');
      const relayFlightSec = pivotPlayer
        ? throwTimeSec(targetPt, firstPt, pivotPos, pivotPlayer.skills.throwing)
        : TIME.throwToBaseSec;
      // Pivot receives at 2B, brief turn, then fires to first.
      const relayDelay = TIME.fieldedToThrowSec + throwFlightSec + 0.18;
      push({
        type: 'throw',
        fromPosition: pivotPos, fromPlayerId: pivotPlayer?.id ?? -1,
        fromPoint: targetPt,
        toBase: 'first',
        toPoint: firstPt,
        flightSec: relayFlightSec,
      }, relayDelay);
    }

    // Phase 5.15: backup fielder chases behind the bag on a throwing
    // error so the visual reads as a wild throw being run down.
    if (ab.result === 'reached-on-error' && ab.errorType === 'throw') {
      const backupMap: Record<'first' | 'second' | 'third' | 'home', Position> = {
        first: 'RF', second: 'CF', third: 'LF', home: 'P',
      };
      const backupPos = backupMap[targetBase];
      push({
        type: 'fielder-converge',
        position: backupPos,
        playerId: defenseMap?.get(backupPos)?.id ?? -1,
        fromPoint: FIELDER_POSITIONS_FT[backupPos],
        toPoint: targetPt,
        reachSec: throwFlightSec + 0.4,
        role: 'backup',
      }, 0);
    }
  } else if (!isCaught && !isInfielder && coverage.throwTarget) {
    // Outfield hit → primary throw, optionally relayed through cutoff.
    const targetBase = coverage.throwTarget;
    const targetPt = basePoint(targetBase);
    const ofDef = fielderPlayer?.skills.fielding ?? 5;
    if (coverage.cutoff) {
      // Two-hop relay: OF → cutoff IF, then cutoff → final base.
      const cutoffPt = coverage.cutoff.toPoint;
      const cutoffPos = coverage.cutoff.position;
      const cutoffPlayer = defenseMap?.get(cutoffPos);
      const flight1 = throwTimeSec(playPoint, cutoffPt, ab.fieldedBy, ofDef);
      const flight2 = cutoffPlayer
        ? throwTimeSec(cutoffPt, targetPt, cutoffPos, cutoffPlayer.skills.throwing)
        : TIME.throwToBaseSec;
      // Throw 1: OF → cutoff (relay leg — PBP should read "to cutoff")
      // Delay the throw so:
      //   (a) the OF has fielded the ball: delay >= reachSec + fieldedToThrow
      //   (b) the ball arrives AFTER the cutoff man sets up:
      //       delay + flight1 >= cutoffTravelSec
      //       delay >= cutoffTravelSec - flight1
      // push(e, dt) advances the global clock from contact time, so dt
      // must include the full delay from contact.
      const throwAfterCatch = reachSec + TIME.fieldedToThrowSec;
      const throwForCutoff = Math.max(0, cutoffTravelSec - flight1 + 0.15);
      const throwDelay = Math.max(throwAfterCatch, throwForCutoff);
      push({
        type: 'throw',
        fromPosition: ab.fieldedBy, fromPlayerId: fielderPlayer?.id ?? -1,
        fromPoint: playPoint,
        toBase: targetBase,             // ultimate intent
        toPoint: cutoffPt,
        flightSec: flight1,
        isCutoffRelay: true,
        cutoffPosition: cutoffPos,
      }, throwDelay);
      // Throw 2: cutoff → base. Small relay-handle delay between catches.
      push({
        type: 'throw',
        fromPosition: cutoffPos, fromPlayerId: cutoffPlayer?.id ?? -1,
        fromPoint: cutoffPt,
        toBase: targetBase,
        toPoint: targetPt,
        flightSec: flight2,
      }, flight1 + 0.25);
    } else {
      // Direct OF throw (rare with our table — only "no runners on,
      // sac-fly" type exceptions). Keep single-hop.
      const flight = throwTimeSec(playPoint, targetPt, ab.fieldedBy, ofDef);
      push({
        type: 'throw',
        fromPosition: ab.fieldedBy, fromPlayerId: fielderPlayer?.id ?? -1,
        fromPoint: playPoint,
        toBase: targetBase,
        toPoint: targetPt,
        flightSec: flight,
      }, TIME.fieldedToThrowSec);
    }
  }
}
