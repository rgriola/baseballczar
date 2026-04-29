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
  /** Optional facing-indicator ("cap") child: an ellipse sitting on top
   *  of the player body that the renderer rotates to point in the
   *  direction the player is currently facing. Player sprites have one;
   *  the ball does not. Carried on the sprite so `tween.advance` can
   *  update it each frame without needing a separate map lookup. */
  hat?: Graphics;
  /** Hat radial offset from body center, in pixels. Captured at sprite
   *  creation so the same sprite reads correctly at any zoom level. */
  hatOffsetPx?: number;
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
): { c: Container; body: Graphics; hat: Graphics; hatOffsetPx: number } {
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
  // Cap: a small directional wedge (triangle) drawn at the body
  // center, apex along +x. `tween.advance` rotates it to point in the
  // direction the player is facing — the apex/brim is unambiguous, so
  // there's no front/back ambiguity like a symmetric ellipse would have.
  const hatOffsetPx = 0;
  const hat = new Graphics()
    .moveTo(radiusPx * 1.15, 0)
    .lineTo(-radiusPx * 0.25, -radiusPx * 0.55)
    .lineTo(-radiusPx * 0.25, radiusPx * 0.55)
    .closePath()
    .fill({ color: 0x111111, alpha: 0.95 })
    .stroke({ color: 0xffffff, width: 0.5 });
  c.addChild(hat);
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
  return { c, body, hat, hatOffsetPx };
}

/** Build a runner sprite — colored circle body with a soft shadow and a
 *  facing cap. The cap is repositioned each frame by `tween.advance`. */
export function makeRunnerSprite(
  color: number, radiusPx: number,
): { c: Container; hat: Graphics; hatOffsetPx: number } {
  const c = new Container();
  const shadow = new Graphics()
    .ellipse(0, radiusPx * 0.55, radiusPx * 1.05, radiusPx * 0.45)
    .fill({ color: 0x000000, alpha: 0.32 });
  c.addChild(shadow);
  const body = new Graphics()
    .circle(0, 0, radiusPx).fill(color)
    .stroke({ color: 0x111111, width: 0.5 });
  c.addChild(body);
  const hatOffsetPx = 0;
  const hat = new Graphics()
    .moveTo(radiusPx * 1.15, 0)
    .lineTo(-radiusPx * 0.25, -radiusPx * 0.55)
    .lineTo(-radiusPx * 0.25, radiusPx * 0.55)
    .closePath()
    .fill({ color: 0x111111, alpha: 0.95 })
    .stroke({ color: 0xffffff, width: 0.5 });
  c.addChild(hat);
  return { c, hat, hatOffsetPx };
}
