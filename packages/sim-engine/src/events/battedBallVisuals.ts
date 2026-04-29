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

  push({
    type: 'contact',
    exitVeloMph: ball.exitVeloMph,
    launchAngleDeg: ball.launchAngleDeg,
    sprayAngleDeg: ball.sprayAngleDeg,
    distanceFt: ball.distanceFt,
    hangTimeSec: ball.hangTimeSec,
    peakHeightFt: ball.peakHeightFt,
    landingPoint: playPoint,
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
  // Emit converge AT contact (dt=0) so the fielder starts breaking on
  // contact and the catch happens as the ball arrives — not after the
  // ball has already landed and is sitting on the grass.
  push({
    type: 'fielder-converge',
    position: ab.fieldedBy,
    playerId: fielderPlayer?.id ?? -1,
    fromPoint: fielderPt,
    toPoint: playPoint,
    reachSec,
  }, 0);

  // Phase 5.16: dive/leap when the converge is tight against hangtime.
  // We treat reach within 0.25s of hangtime as "diving" effort. Leap is
  // reserved for line drives / low flies fielded by an OF (high catch).
  if (ball.hangTimeSec > 0.4 && Math.abs(reachSec - ball.hangTimeSec) < 0.25) {
    const isOF = ['LF', 'CF', 'RF'].includes(ab.fieldedBy);
    const isLineLike = ball.launchAngleDeg < 18;
    const variant: 'dive' | 'leap' = isOF && !isLineLike ? 'leap' : 'dive';
    const successful = ['fly-out', 'line-out', 'pop-out', 'sac-fly'].includes(ab.result);
    push({
      type: 'fielder-dive',
      position: ab.fieldedBy,
      playerId: fielderPlayer?.id ?? -1,
      atPoint: playPoint,
      variant,
      successful,
    }, reachSec);
  }

  // Infielder throw to 1B for ground-outs / FCs
  const isInfielder = !['LF', 'CF', 'RF'].includes(ab.fieldedBy);
  const isCaught = ['fly-out', 'line-out', 'pop-out', 'sac-fly'].includes(ab.result);

  // ─── Ball-roll segment (post-landing) ────────────────────────
  // For fly balls that drop fair and aren't caught, the ball bounces
  // and rolls from `landingPoint` toward the fielder's intercept point
  // (already resolved into `ab.battedBall.fieldedAtPoint` by the
  // engine). Emit a `ball-roll` so the renderer tweens the ball along
  // the grass instead of stopping it dead at the landing spot.
  // Skipped for: grounders (continuous trajectory; no separate landing
  // beat in the visual), HRs (left the field), foul-outs (caught in
  // the air), and any caught-fly result.
  const isGrounderVisual = ball.launchAngleDeg < 5;
  if (!isCaught && !isGrounderVisual && !ball.isHomeRun && !ball.isFoul
      && ball.fieldedAtPoint) {
    const rollDx = ball.fieldedAtPoint.x - ball.landingPoint.x;
    const rollDy = ball.fieldedAtPoint.y - ball.landingPoint.y;
    const rollLen = Math.hypot(rollDx, rollDy);
    if (rollLen > 1) {
      // Time the ball spends rolling = distance / average roll speed
      // (avg of landing speed and 0). Falls back to a short floor so
      // the visual reads even on a tiny dribble past the landing.
      const avgSpeed = Math.max(8, ball.landingSpeedFps * 0.5);
      const rollSec = Math.max(0.15, rollLen / avgSpeed);
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
    sprayAngleDeg: ball.sprayAngleDeg,
  });
  // PI gate: low-PI fielder may downgrade the throw target to a
  // safer base, conceding the lead runner. High-PI fielders execute
  // the textbook play almost every time. Pure replay-time roll
  // seeded from team ids in buildEvents — reproducible. Phase 4
  // adds score/inning-aware difficulty modifiers via gameContext.
  const coverage = rng ? decideThrowTarget(coverage0, fielderPlayer, rng, gameContext) : coverage0;

  // All cover / cutoff / backup fielders break at contact (dt=0). The
  // renderer tweens them to their assigned point.
  for (const c of coverage.covers) {
    push({
      type: 'cover-base',
      position: c.position,
      base: c.base,
      fromPoint: FIELDER_POSITIONS_FT[c.position],
      toPoint: c.toPoint,
      arriveSec: Math.max(0.6, ball.hangTimeSec || TIME.contactToFieldedDefault),
    }, 0);
  }
  if (coverage.cutoff) {
    push({
      type: 'fielder-converge',
      position: coverage.cutoff.position,
      playerId: defenseMap?.get(coverage.cutoff.position)?.id ?? -1,
      fromPoint: FIELDER_POSITIONS_FT[coverage.cutoff.position],
      toPoint: coverage.cutoff.toPoint,
      reachSec: Math.max(0.8, (ball.hangTimeSec || TIME.contactToFieldedDefault) * 0.9),
    }, 0);
  }
  for (const bk of coverage.backups) {
    push({
      type: 'fielder-converge',
      position: bk.position,
      playerId: defenseMap?.get(bk.position)?.id ?? -1,
      fromPoint: FIELDER_POSITIONS_FT[bk.position],
      toPoint: bk.toPoint,
      reachSec: Math.max(1.0, (ball.hangTimeSec || TIME.contactToFieldedDefault) * 1.1),
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
      ? throwTimeSec(playPoint, targetPt, ab.fieldedBy, fielderPlayer.skills.defense)
      : TIME.throwToBaseSec;
    push({
      type: 'throw',
      fromPosition: ab.fieldedBy, fromPlayerId: fielderPlayer?.id ?? -1,
      fromPoint: playPoint,
      toBase: targetBase,
      toPoint: targetPt,
      flightSec: throwFlightSec,
    }, TIME.fieldedToThrowSec);

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
      }, 0);
    }
  } else if (!isCaught && !isInfielder && coverage.throwTarget) {
    // Outfield hit → primary throw, optionally relayed through cutoff.
    const targetBase = coverage.throwTarget;
    const targetPt = basePoint(targetBase);
    const ofDef = fielderPlayer?.skills.defense ?? 5;
    if (coverage.cutoff) {
      // Two-hop relay: OF → cutoff IF, then cutoff → final base.
      const cutoffPt = coverage.cutoff.toPoint;
      const cutoffPos = coverage.cutoff.position;
      const cutoffPlayer = defenseMap?.get(cutoffPos);
      const flight1 = throwTimeSec(playPoint, cutoffPt, ab.fieldedBy, ofDef);
      const flight2 = cutoffPlayer
        ? throwTimeSec(cutoffPt, targetPt, cutoffPos, cutoffPlayer.skills.defense)
        : TIME.throwToBaseSec;
      // Throw 1: OF → cutoff
      push({
        type: 'throw',
        fromPosition: ab.fieldedBy, fromPlayerId: fielderPlayer?.id ?? -1,
        fromPoint: playPoint,
        toBase: targetBase,             // ultimate intent (renderer can label)
        toPoint: cutoffPt,
        flightSec: flight1,
      }, TIME.fieldedToThrowSec);
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
