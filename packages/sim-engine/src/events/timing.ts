/**
 * Time budgets and small timing helpers used across the event builder.
 * Pure constants + math — no I/O, no event creation.
 *
 * All durations are in sim seconds. Velocities in feet/second.
 */
import { BASE_COORDS_FT } from '../physics/speed';

export const TIME = {
  pitchToHomeSec: 0.45,        // ~95 mph fastball
  betweenPitchesSec: 12,       // batter steps out, pitcher gathers
  contactToFieldedDefault: 1.5,
  fieldedToThrowSec: 0.6,      // glove → release
  throwToBaseSec: 1.0,         // average infield throw
  betweenAtBatsSec: 25,
  betweenInningsSec: 120,
  /** Pre-game warm-up gap before the FIRST inning-start. Long enough
   *  to cover the take-the-field intro jog (capped at ~12s in the
   *  renderer) but far shorter than the 120s used between later
   *  innings, so the playback doesn't open with two minutes of dead
   *  screen before anything moves. */
  preGameSec: 15,
  /** Reaction time between contact and a runner taking off. */
  runnerReactionSec: 0.4,
  /** Time to traverse one 90-ft segment (home→1B, 1B→2B, etc.). */
  perBaseSec: 3.5,
  /** Catcher pause before lobbing the ball back to the pitcher. */
  catcherHoldSec: 0.5,
  /** Fielder pause after fielding before throwing back to the pitcher
   *  on a no-throw play (caught fly, ball ending up in their glove
   *  at a base on an infield out). */
  fielderHoldSec: 0.7,
  /** Umpire delay handing a fresh ball to the pitcher after the live
   *  ball leaves the field (HR, foul into stands). */
  umpireHoldSec: 1.5,
  /** Ball-flight speed (ft/sec) for a routine return throw to the
   *  pitcher. "Slow" is the catcher's lazy lob, "normal" is a fielder
   *  arc throw back to the mound. */
  ballReturnSlowFtPerSec: 75,
  ballReturnNormalFtPerSec: 110,
} as const;

/** Compute flight time for a ball-return throw based on distance. */
export function ballReturnFlightSec(
  from: { x: number; y: number },
  to: { x: number; y: number },
  slow: boolean,
): number {
  const d = Math.hypot(from.x - to.x, from.y - to.y);
  const v = slow ? TIME.ballReturnSlowFtPerSec : TIME.ballReturnNormalFtPerSec;
  return Math.max(0.4, d / v);
}

/** Convert a base name to its field coordinate. Home = origin. */
export function basePoint(b: 'home' | 'first' | 'second' | 'third'):
    { x: number; y: number } {
  if (b === 'home') return { x: 0, y: 0 };
  return BASE_COORDS_FT[b];
}
