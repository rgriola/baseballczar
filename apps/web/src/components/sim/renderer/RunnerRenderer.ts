import { Container, Graphics } from 'pixi.js';
import gsap from 'gsap';
import type { Point } from '../engine/AnimationQueue';
import type { Speed } from '../engine/useSimPlayer';

// Time to cover 90 ft (one base) at 1× playback speed.
// Real-world reference: a fast runner (Speed 10) makes home→1B in ~3.15s,
// a slow runner (Speed 0) in ~3.91s. We use the midpoint as the default
// so playback feels like real baseball; per-player speed can be layered
// on top later by passing a multiplier through.
const BASE_DURATION_MS = 3500;

/**
 * Move a player/runner display object from one base to another.
 */
export function animateRunner(
  runner: Container,
  from: Point,
  to: Point,
  speed: Speed,
): Promise<void> {
  runner.x = from.x;
  runner.y = from.y;
  runner.visible = true;

  return new Promise<void>((resolve) => {
    gsap.to(runner, {
      x: to.x,
      y: to.y,
      duration: (BASE_DURATION_MS / speed) / 1000,
      ease: 'power1.inOut',
      onComplete: resolve,
    });
  });
}

/**
 * Quick swing/lunge for the batter. Designed to be short (~250ms at 1×)
 * so it can be played in parallel with the pitch and finish right around
 * when the ball reaches home plate.
 */
export function animateSwing(
  batter: Container,
  speed: Speed,
): Promise<void> {
  const startX = batter.x;
  const startY = batter.y;
  const lungeX = startX + (startX < 400 ? 8 : -8);
  // Pitch takes ~450ms at 1× (BallRenderer), so delay the swing so the bat
  // meets the ball near the end of the pitch.
  const delay = (300 / speed) / 1000;
  const halfDur = (120 / speed) / 1000;
  return new Promise<void>((resolve) => {
    gsap.to(batter, {
      x: lungeX,
      y: startY - 4,
      duration: halfDur,
      delay,
      ease: 'power2.out',
      onComplete() {
        gsap.to(batter, {
          x: startX,
          y: startY,
          duration: halfDur,
          ease: 'power1.in',
          onComplete: () => resolve(),
        });
      },
    });
  });
}

/**
 * Flash a graphic briefly to show a swing / contact effect.
 */
export function flashContact(gfx: Container | Graphics, speed: Speed): Promise<void> {
  return new Promise<void>((resolve) => {
    gsap.to(gfx, {
      alpha: 0.2,
      duration: 0.06 / speed,
      yoyo: true,
      repeat: 3,
      onComplete() {
        gfx.alpha = 1;
        resolve();
      },
    });
  });
}
