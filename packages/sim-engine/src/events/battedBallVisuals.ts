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
import type { SimEventInit } from './types';
import { TIME, basePoint } from './timing';

export function emitBattedBallVisuals(
  ball: BattedBall,
  ab: AtBatRecord,
  push: (e: SimEventInit, dt: number) => void,
  defenseMap?: Map<Position, Player>,
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
    landingPoint: playPoint,
    isFoul: ball.isFoul,
    isHomeRun: ball.isHomeRun,
  }, 0);

  // Fielder converge/throw — only if a fielder was assigned
  if (!ab.fieldedBy) return;
  const fielderPt = FIELDER_POSITIONS_FT[ab.fieldedBy];
  const fielderPlayer = defenseMap?.get(ab.fieldedBy);
  const reachSec = ball.hangTimeSec || TIME.contactToFieldedDefault;
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
  if (!isCaught && isInfielder) {
    const targetBase = ab.result === 'double-play' || ab.result === 'fielders-choice'
      ? 'second' as const
      : 'first' as const;
    // Pick who covers the target base. Default cover fielder for the bag,
    // but if the cover fielder is the one who just fielded the ball, fall
    // back to a sensible alternate (e.g. P covers 1B if B1 fielded it).
    const defaultCover: Record<'first' | 'second' | 'third' | 'home', Position> = {
      first: 'B1', second: 'B2', third: 'B3', home: 'C',
    };
    let coverPos: Position = defaultCover[targetBase];
    if (coverPos === ab.fieldedBy) {
      if (targetBase === 'first') coverPos = 'P';
      else if (targetBase === 'second') coverPos = ab.fieldedBy === 'B2' ? 'SS' : 'B2';
      else if (targetBase === 'third') coverPos = 'SS';
      else coverPos = 'P';
    }
    // Cover fielder breaks the moment the ball is fielded (same time the
    // throw is released). Time to the bag is the throw flight minus a
    // small head-start so they're set when the ball arrives.
    const targetPt = basePoint(targetBase);
    const throwFlightSec = fielderPlayer
      ? throwTimeSec(playPoint, targetPt, ab.fieldedBy, fielderPlayer.skills.defense)
      : TIME.throwToBaseSec;
    const coverArrive = Math.max(0.4, throwFlightSec - 0.2);
    push({
      type: 'cover-base',
      position: coverPos,
      base: targetBase,
      fromPoint: FIELDER_POSITIONS_FT[coverPos],
      toPoint: targetPt,
      arriveSec: coverArrive,
    }, 0);
    push({
      type: 'throw',
      fromPosition: ab.fieldedBy, fromPlayerId: fielderPlayer?.id ?? -1,
      fromPoint: playPoint,
      toBase: targetBase,
      toPoint: targetPt,
      flightSec: throwFlightSec,
    }, TIME.fieldedToThrowSec);

    // Phase 5.15: backup fielder chases behind the bag on a throwing
    // error so the visual reads as a wild throw being run down. Backup
    // assignments mirror standard MLB practice (OF behind same-side IF).
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
  }
}
