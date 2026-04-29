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
  if (sprite.durSec <= 0) {
    // Idle: keep the cap pointing toward home plate so a stationary
    // fielder/runner reads as facing the play.
    if (sprite.hat) updateHatFacing(sprite, transform, null);
    return;
  }
  const u = Math.min(1, Math.max(0, (clockSec - sprite.startT) / sprite.durSec));
  sprite.cur = lerpFt(sprite.from, sprite.to, u);
  const px = ftToPx(sprite.cur, transform);
  let yOffset = 0;
  if (sprite.arc === 'fly') yOffset = arcLiftPx(u, sprite.apexFt, transform);
  else if (sprite.arc === 'grounder') yOffset = grounderBouncePx(u, transform);
  else if (sprite.arc === 'pitch') yOffset = pitchLiftPx(u, transform);
  sprite.gfx.position.set(px.x, px.y - yOffset);
  // Cap follows direction of motion. We use the from→to vector (constant
  // for the whole tween) so the cap doesn't jitter on near-zero per-frame
  // deltas at the end of a tween. Falls back to facing home when the
  // movement vector is degenerate.
  if (sprite.hat) {
    const dx = sprite.to.x - sprite.from.x;
    const dy = sprite.to.y - sprite.from.y;
    if (Math.hypot(dx, dy) > 0.5) {
      updateHatFacing(sprite, transform, { dx, dy });
    } else {
      updateHatFacing(sprite, transform, null);
    }
  }
  if (u >= 1) sprite.durSec = 0;
}

/**
 * Position + rotate the cap. `motion` is an engine-feet vector (where
 * the player is heading). When null, the cap points toward home plate
 * (engine origin), which is the natural "ready / between-plays" pose.
 *
 * Engine→screen y is flipped (`ftToPx` uses `homeY - pt.y * scale`),
 * so motion in engine coords must be flipped on y before computing the
 * screen-space angle for Pixi rotation.
 */
function updateHatFacing(
  sprite: MovingSprite,
  _transform: FieldTransform,
  motion: { dx: number; dy: number } | null,
): void {
  const hat = sprite.hat!;
  const offset = sprite.hatOffsetPx ?? 0;
  let dx: number;
  let dy: number;
  if (motion) {
    dx = motion.dx;
    dy = motion.dy;
  } else {
    // Face home: vector from current position back to (0, 0).
    dx = -sprite.cur.x;
    dy = -sprite.cur.y;
    if (Math.hypot(dx, dy) < 0.5) {
      // Standing on home plate (e.g. batter): face up the field.
      dx = 0;
      dy = 1;
    }
  }
  // Flip y for screen-space (engine +y = up the field = screen -y).
  const screenDy = -dy;
  const angle = Math.atan2(screenDy, dx);
  hat.position.set(Math.cos(angle) * offset, Math.sin(angle) * offset);
  hat.rotation = angle;
}
