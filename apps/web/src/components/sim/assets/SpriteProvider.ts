import { Container, Graphics, Text, TextStyle } from 'pixi.js';

/**
 * Placeholder sprite factories.
 * Phase 5: Replace these with real PIXI.AnimatedSprite / PIXI.Sprite instances
 * loaded from a spritesheet — no other files need to change.
 */

export interface PlayerSprite {
  /** Container holds the body circle plus jersey-number text. Move this. */
  gfx: Container;
  label: string;
}

export interface BallSprite {
  gfx: Graphics;
}

const JERSEY_STYLE = new TextStyle({
  fill: 0xffffff,
  fontSize: 10,
  fontFamily: 'monospace',
  fontWeight: 'bold',
  stroke: { color: 0x000000, width: 2 },
});

export function createPlaceholderPlayer(color: number, jersey: string | number = ''): PlayerSprite {
  const container = new Container();
  const body = new Graphics();
  body.circle(0, 0, 10).fill(color);
  container.addChild(body);

  const label = String(jersey ?? '');
  if (label) {
    const text = new Text({ text: label, style: JERSEY_STYLE });
    text.anchor.set(0.5, 0.5);
    text.x = 0;
    text.y = 0;
    container.addChild(text);
  }
  return { gfx: container, label };
}

export function createPlaceholderBall(): BallSprite {
  const gfx = new Graphics();
  gfx.circle(0, 0, 5).fill(0xffffff).stroke({ width: 1, color: 0xaaaaaa });
  return { gfx };
}
