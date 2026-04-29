/**
 * Runner sprite lifecycle: spawn, place, walk-on, send-to-dugout, despawn.
 *
 * Built as a factory closure around the shared runner Map + Pixi layer
 * + transform so the scene module can keep its current structure
 * (everything that needs to mutate `runners` lives on the manager).
 */
import { type Container } from 'pixi.js';
import {
  BASE_COORDS_FT,
  sprintFtPerSec,
} from '@baseballczar/sim-engine';
import {
  type FieldTransform,
  ftToPx,
} from '../coords';
import { dugoutSpotFt } from '../field/drawField';
import {
  type RunnerSprite,
  makeRunnerSprite,
} from './sprites';
import { startTween } from './tween';

interface Deps {
  runners: Map<number, RunnerSprite>;
  layerRunners: Container;
  transform: FieldTransform;
  playerRadiusPx: number;
  /** Color used for the home team — needed so we can pick the right dugout. */
  homeColor: number;
}

export interface RunnerManager {
  ensureRunner: (
    runnerId: number,
    initBase: 'home' | 'first' | 'second' | 'third',
    teamColor: number,
  ) => RunnerSprite;
  ensureBatter: (
    batterId: number,
    hand: 'L' | 'R' | 'S',
    pitcherHand: 'L' | 'R',
    teamColor: number,
    speedSkill: number,
    walkOutAtT?: number,
  ) => void;
  removeRunner: (runnerId: number) => void;
  sendToDugout: (runnerId: number, atClockSec: number) => void;
}

export function createRunnerManager(deps: Deps): RunnerManager {
  const { runners, layerRunners, transform, playerRadiusPx, homeColor } = deps;

  /** Get-or-create a runner sprite, placed initially at the given base. */
  const ensureRunner: RunnerManager['ensureRunner'] = (runnerId, initBase, teamColor) => {
    let r = runners.get(runnerId);
    if (r) return r;
    const ft = initBase === 'home' ? { x: 0, y: 0 } : BASE_COORDS_FT[initBase];
    const { c: gfx, hat, hatOffsetPx } = makeRunnerSprite(teamColor, playerRadiusPx);
    const px = ftToPx(ft, transform);
    gfx.position.set(px.x, px.y);
    layerRunners.addChild(gfx);
    r = {
      gfx, teamColor, hat, hatOffsetPx,
      speed: 5,
      cur: { ...ft }, from: { ...ft }, to: { ...ft },
      startT: 0, durSec: 0, arc: 'line', apexFt: 0,
    };
    runners.set(runnerId, r);
    return r;
  };

  /**
   * Place the batter as a runner sprite in the correct batter's box based on
   * their hand ('L'|'R'|'S'). Engine coords: +x toward 1B, +y toward CF.
   * RH batter stands on the 3B side (negative x); LH on the 1B side (+x).
   * Switch hitter bats opposite the pitcher's throwing hand (vs LHP → RHB,
   * vs RHP → LHB), per standard baseball platoon convention.
   *
   * Box geometry (must stay in sync with FIELD_SPEC in drawField.ts):
   *   plateHalfWidthFt = 0.708, batterBoxOffsetFt = 0.5, batterBoxWidthFt = 4
   *   → box-center x = ±(0.708 + 0.5 + 4/2) = ±3.208 ft
   */
  const ensureBatter: RunnerManager['ensureBatter'] = (
    batterId, hand, pitcherHand, teamColor, speedSkill, walkOutAtT,
  ) => {
    if (runners.has(batterId)) return; // already on base from prev AB? unlikely
    const xMag = 3.208;
    // Switch hitter: bat opposite the pitcher's throwing hand.
    const effectiveHand: 'L' | 'R' = hand === 'S'
      ? (pitcherHand === 'R' ? 'L' : 'R')
      : hand;
    const standsRight = effectiveHand === 'R';
    const ft = { x: standsRight ? -xMag : xMag, y: 0 };
    const { c: gfx, hat, hatOffsetPx } = makeRunnerSprite(teamColor, playerRadiusPx);
    // For the pre-game leadoff, start the batter in the away dugout
    // (3B side) and walk them to the box. Subsequent batters just
    // appear in the box (they're already "on deck").
    const startFt = walkOutAtT != null
      ? dugoutSpotFt(false, standsRight ? -8 : 8, 5)
      : ft;
    const px = ftToPx(startFt, transform);
    gfx.position.set(px.x, px.y);
    layerRunners.addChild(gfx);
    const sprite: RunnerSprite = {
      gfx, teamColor, hat, hatOffsetPx,
      speed: speedSkill,
      cur: { ...startFt }, from: { ...startFt }, to: { ...startFt },
      startT: 0, durSec: 0, arc: 'line', apexFt: 0,
    };
    runners.set(batterId, sprite);
    if (walkOutAtT != null) {
      // Walk pace = ~50% of sprint speed, so a slow slugger ambles in
      // around 11 ft/s and a burner trots at 14 ft/s.
      const walkFps = sprintFtPerSec(speedSkill) * 0.50;
      const distFt = Math.hypot(ft.x - startFt.x, ft.y - startFt.y);
      const walkSec = Math.max(1.5, distFt / walkFps);
      startTween(sprite, ft, walkSec, walkOutAtT, 'line');
    }
  };

  const removeRunner: RunnerManager['removeRunner'] = (runnerId) => {
    const r = runners.get(runnerId);
    if (!r) return;
    layerRunners.removeChild(r.gfx);
    r.gfx.destroy();
    runners.delete(runnerId);
  };

  /**
   * Animate a runner walking back to their team's dugout, then remove the
   * sprite once they've cleared the field. Home team uses the 1B-side
   * dugout, away uses the 3B-side. Inferred from the sprite's team color.
   */
  const sendToDugout: RunnerManager['sendToDugout'] = (runnerId, atClockSec) => {
    const r = runners.get(runnerId);
    if (!r) return;
    const homeSide = r.teamColor === homeColor;
    const alongOffset = ((runnerId * 37) % 41) - 20; // -20..+20 ft along bench
    const dest = dugoutSpotFt(homeSide, alongOffset, 5);
    // Hustle pace off the field: ~80% of sprint (jogging, not sprinting).
    const jogFps = sprintFtPerSec(r.speed) * 0.80;
    const distFt = Math.hypot(dest.x - r.cur.x, dest.y - r.cur.y);
    const walkSec = Math.max(0.6, distFt / jogFps);
    startTween(r, dest, walkSec, atClockSec, 'line');
    // Once they arrive, fade + shrink so they read as INSIDE the dugout
    // (sitting on the bench / in shadow) rather than perched on the rim.
    setTimeout(() => {
      if (!runners.has(runnerId)) return;
      if (r.gfx.destroyed) return;
      r.gfx.alpha = 0.55;
      r.gfx.scale.set(0.7);
    }, Math.ceil(walkSec * 1000) + 50);
    // Keep them visible in the dugout for a few seconds, then despawn so
    // the bench doesn't accumulate forever.
    setTimeout(() => removeRunner(runnerId), Math.ceil(walkSec * 1000) + 4000);
  };

  return { ensureRunner, ensureBatter, removeRunner, sendToDugout };
}
