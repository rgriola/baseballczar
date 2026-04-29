/**
 * Pre-game intro + fielder-positioning helpers.
 *
 * `stageHomeTeamInDugout` snaps the fielders into the home (1B-side)
 * dugout at game-start so the first inning-start can animate them
 * jogging out to their positions. `playFieldersToPositions` runs that
 * jog (or a quick 0.5s snap on later innings).
 */
import {
  FIELDER_POSITIONS_FT,
  sprintFtPerSec,
  type Position,
} from '@baseballczar/sim-engine';
import { type FieldTransform, ftToPx } from '../coords';
import { dugoutSpotFt } from '../field/drawField';
import type { MovingSprite } from './sprites';
import { startTween } from './tween';

/**
 * Order in which fielders jog out of the dugout for the pre-game intro.
 * Pitcher leads (he needs to be on the mound first to throw warmups),
 * then catcher, then infielders close to far, then outfielders.
 * Used to stagger their dugout-bench positions so they don't stack.
 */
export const POSITION_ORDER: Position[] = [
  'P', 'C', 'B1', 'B2', 'B3', 'SS', 'LF', 'CF', 'RF',
];

/**
 * Snap every fielder into the home (1B-side) dugout. No tweening — this
 * is the staging step at game-start before the actual jog-out plays at
 * the first inning-start.
 */
export function stageHomeTeamInDugout(
  fielders: Map<Position, MovingSprite>,
  transform: FieldTransform,
): void {
  for (const [pos, sp] of fielders) {
    // Stagger fielders along the dugout so they don't stack on
    // top of each other before they break.
    const seed = (POSITION_ORDER.indexOf(pos) + 1) * 6 - 21; // -15..+27 ft
    const dugoutPt = dugoutSpotFt(true, seed, 4);
    sp.cur = { ...dugoutPt };
    sp.from = { ...dugoutPt };
    sp.to = { ...dugoutPt };
    sp.durSec = 0;
    const px = ftToPx(dugoutPt, transform);
    sp.gfx.position.set(px.x, px.y);
  }
}

/**
 * Move every fielder to their position-of-record. In `intro` mode they
 * sprint at full speed out of the dugout (skill 1–10 → 22–28 ft/s), so
 * a fast CF still outpaces a slow 1B without a fixed cascade. The
 * duration is capped at `INTRO_MAX_SEC` so the slowest fielder is
 * guaranteed to be in position well before the leadoff at-bat begins
 * (engine pushes `at-bat-start` 25s after `inning-start`). Outside
 * intro mode this is a quick 0.5s snap used at every inning-start.
 */
const INTRO_MIN_SEC = 2.0;
const INTRO_MAX_SEC = 12.0;

export function playFieldersToPositions(
  fielders: Map<Position, MovingSprite>,
  atClockSec: number,
  opts: { intro: boolean; speedByPos?: Map<Position, number> },
): void {
  const { intro, speedByPos } = opts;
  for (const [pos, sp] of fielders) {
    const home = FIELDER_POSITIONS_FT[pos];
    if (intro) {
      const speed = speedByPos?.get(pos) ?? 5;
      const sprintFps = sprintFtPerSec(speed);
      const dist = Math.hypot(home.x - sp.cur.x, home.y - sp.cur.y);
      const dur = Math.min(INTRO_MAX_SEC, Math.max(INTRO_MIN_SEC, dist / sprintFps));
      startTween(sp, home, dur, atClockSec, 'line');
    } else {
      startTween(sp, home, 0.5, atClockSec, 'line');
    }
  }
}
