import { Application, Graphics } from 'pixi.js';
import gsap from 'gsap';
import type { Point } from '../engine/AnimationQueue';
import type { Speed } from '../engine/useSimPlayer';

// ── Real-world calibration ──────────────────────────────────────
// The diamond on screen: home (400,535) → 1B (540,395) is 90 ft, which
// works out to ~2.2 px per foot. We use that to convert ball flight
// distance into realistic flight times.
const PX_PER_FOOT = 2.2;

/** Typical MLB infield/outfield throw, ~65 ft/s (~45 mph). */
const THROW_FPS = 65;
/** Major-league fastball, ~125 ft/s (~85 mph). */
const PITCH_FPS = 125;
/** Slowest reasonable speed (a tap roller). Prevents 0-distance divide. */
const MIN_DURATION_MS = 120;

function distancePx(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function flightDurationMs(from: Point, to: Point, fps: number): number {
  const ft = distancePx(from, to) / PX_PER_FOOT;
  const ms = (ft / fps) * 1000;
  return Math.max(MIN_DURATION_MS, ms);
}

function dur(ms: number, speed: Speed): number {
  return (ms / speed) / 1000; // gsap uses seconds
}

/**
 * Animate the ball along a trajectory.
 * arc='grounder' → straight line near ground
 * arc='line'     → slight arc
 * arc='fly'      → high parabola
 */
export function animateBallFlight(
  ball: Graphics,
  from: Point,
  to: Point,
  arc: 'line' | 'fly' | 'grounder',
  speed: Speed,
): Promise<void> {
  ball.x = from.x;
  ball.y = from.y;
  ball.visible = true;

  const arcHeight = arc === 'fly' ? -180 : arc === 'line' ? -50 : -10;
  // Grounders roll a bit slower than air throws; flies are at full throw
  // speed (a long fly travels ~70 mph off the bat). Line drives travel
  // at the standard infield throw speed.
  const fps = arc === 'grounder' ? 45 : arc === 'fly' ? 95 : THROW_FPS;
  const duration = dur(flightDurationMs(from, to, fps), speed);
  const midX = (from.x + to.x) / 2;
  const midY = Math.min(from.y, to.y) + arcHeight;

  return new Promise<void>((resolve) => {
    // Two-segment bezier-like motion via gsap motionPath proxy
    // Using a simple quadratic approach: animate x linearly, y via custom ease
    const progress = { t: 0 };
    gsap.to(progress, {
      t: 1,
      duration,
      ease: 'power1.inOut',
      onUpdate() {
        const t = progress.t;
        // Quadratic bezier: B(t) = (1-t)^2*P0 + 2(1-t)t*P1 + t^2*P2
        const mt = 1 - t;
        ball.x = mt * mt * from.x + 2 * mt * t * midX + t * t * to.x;
        ball.y = mt * mt * from.y + 2 * mt * t * midY + t * t * to.y;
      },
      onComplete() {
        // The ball is a physical object — leave it where it landed so the
        // next animation can pick it up from there.
        resolve();
      },
    });
  });
}

/**
 * Animate a pitch from mound to home plate.
 */
export function animatePitch(
  ball: Graphics,
  from: Point,
  to: Point,
  speed: Speed,
): Promise<void> {
  ball.x = from.x;
  ball.y = from.y;
  ball.visible = true;

  return new Promise<void>((resolve) => {
    gsap.to(ball, {
      x: to.x,
      y: to.y,
      duration: dur(flightDurationMs(from, to, PITCH_FPS), speed),
      ease: 'power2.in',
      onComplete() {
        // Keep the ball visible at home — catcher has it now.
        resolve();
      },
    });
  });
}
