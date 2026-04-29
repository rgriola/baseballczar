/**
 * Sprite types and factories used by the scene.
 *
 * The `MovingSprite` interface is the shared shape carried by every
 * tween-able actor on the field (ball, fielders, runners). Tween
 * helpers in `./tween` operate on this shape.
 */
import { Container, Graphics, Text } from 'pixi.js';
import type { Position } from '@baseballczar/sim-engine';

export interface MovingSprite {
  gfx: Container;
  /** Current position in engine feet. */
  cur: { x: number; y: number };
  /** Tween start. */
  from: { x: number; y: number };
  /** Tween end. */
  to: { x: number; y: number };
  /** Engine-time tween started. */
  startT: number;
  /** Tween duration (engine seconds). */
  durSec: number;
  /** 'line' = no arc, 'fly' = parabolic lift, 'grounder' = small bounces, 'pitch' = release→plate ramp. */
  arc: 'line' | 'fly' | 'grounder' | 'pitch';
  /** Apex altitude in feet (for fly arcs only). */
  apexFt: number;
}

export interface RunnerSprite extends MovingSprite {
  teamColor: number;
  /** Sprint speed (skill 1–10). Drives walk/jog cadence in the renderer. */
  speed: number;
}

/**
 * Build a fielder sprite — circle body with shadow + position label.
 * Returns the outer container plus the body Graphics so the scene
 * can recolor bodies when the defense team changes.
 */
export function makeFielderSprite(
  pos: Position, radiusPx: number,
): { c: Container; body: Graphics } {
  const c = new Container();
  // Shadow first so it draws beneath the body. Slightly offset down to
  // suggest a sun overhead and to read as feet planted on the dirt.
  const shadow = new Graphics()
    .ellipse(0, radiusPx * 0.55, radiusPx * 1.05, radiusPx * 0.45)
    .fill({ color: 0x000000, alpha: 0.32 });
  c.addChild(shadow);
  const body = new Graphics()
    .circle(0, 0, radiusPx).fill(0xffffff)
    .stroke({ color: 0x222222, width: 0.5 });
  c.addChild(body);
  // Only show the position label if the sprite is large enough to read it.
  if (radiusPx >= 6) {
    const lbl = new Text({
      text: pos,
      style: {
        fill: 0x222222, fontSize: Math.max(6, radiusPx * 1.1),
        fontFamily: 'system-ui', fontWeight: '700',
      },
    });
    lbl.anchor.set(0.5);
    lbl.position.set(0, 0);
    c.addChild(lbl);
  }
  return { c, body };
}

/** Build a runner sprite — colored circle body with a soft shadow. */
export function makeRunnerSprite(color: number, radiusPx: number): Container {
  const c = new Container();
  const shadow = new Graphics()
    .ellipse(0, radiusPx * 0.55, radiusPx * 1.05, radiusPx * 0.45)
    .fill({ color: 0x000000, alpha: 0.32 });
  c.addChild(shadow);
  const body = new Graphics()
    .circle(0, 0, radiusPx).fill(color)
    .stroke({ color: 0x111111, width: 0.5 });
  c.addChild(body);
  return c;
}
