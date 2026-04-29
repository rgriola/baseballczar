/**
 * Tween primitives operating on `MovingSprite`. Pure — no Pixi or
 * scene state beyond the sprite + a clock value.
 *
 * Convention: `startTween` mutates the sprite to install a new
 * from→to interpolation; `advance` is called every frame to update
 * `cur` and the on-screen `gfx` position based on the engine clock.
 */
import {
  type FieldTransform,
  ftToPx,
  arcLiftPx,
  arcHeightFt,
  grounderBouncePx,
  grounderBounceHeightFt,
  pitchLiftPx,
  pitchHeightFt,
  lerpFt,
} from '../coords';
import type { MovingSprite } from './sprites';

/** Install a new from→to tween on `sprite`, starting at `clockSec`. */
export function startTween(
  sprite: MovingSprite,
  to: { x: number; y: number },
  durSec: number,
  clockSec: number,
  arc: MovingSprite['arc'] = 'line',
  apexFt = 0,
): void {
  sprite.from = { ...sprite.cur };
  sprite.to = { ...to };
  sprite.startT = clockSec;
  sprite.durSec = Math.max(0.05, durSec);
  sprite.arc = arc;
  sprite.apexFt = apexFt;
}

/**
 * Compute current parabolic altitude (in feet) for a tween. Returns 0
 * for non-fly arcs or when the tween isn't running. Used by the ball's
 * shadow + scaling logic.
 */
export function altitudeFt(sprite: MovingSprite, clockSec: number): number {
  if (sprite.durSec <= 0) return 0;
  const u = Math.min(1, Math.max(0, (clockSec - sprite.startT) / sprite.durSec));
  if (sprite.arc === 'fly') return arcHeightFt(u, sprite.apexFt);
  if (sprite.arc === 'grounder') return grounderBounceHeightFt(u);
  if (sprite.arc === 'pitch') return pitchHeightFt(u);
  return 0;
}

/**
 * Advance a tween to its current frame: lerp `cur`, update `gfx.position`,
 * and apply any per-arc vertical lift. Marks the tween done when u >= 1.
 */
export function advance(
  sprite: MovingSprite, clockSec: number, transform: FieldTransform,
): void {
  if (sprite.durSec <= 0) return;
  const u = Math.min(1, Math.max(0, (clockSec - sprite.startT) / sprite.durSec));
  sprite.cur = lerpFt(sprite.from, sprite.to, u);
  const px = ftToPx(sprite.cur, transform);
  let yOffset = 0;
  if (sprite.arc === 'fly') yOffset = arcLiftPx(u, sprite.apexFt, transform);
  else if (sprite.arc === 'grounder') yOffset = grounderBouncePx(u, transform);
  else if (sprite.arc === 'pitch') yOffset = pitchLiftPx(u, transform);
  sprite.gfx.position.set(px.x, px.y - yOffset);
  if (u >= 1) sprite.durSec = 0;
}
