import { Application, Container, Graphics, Text, TextStyle } from 'pixi.js';

/**
 * Coordinate constants — all positions in 800×600 canvas space.
 * These match game_v1.js geometry, cleaned up.
 */
export const FIELD = {
  W: 800,
  H: 600,
  BASE: {
    home:   { x: 400, y: 535 },
    first:  { x: 540, y: 395 },
    second: { x: 400, y: 245 },
    third:  { x: 260, y: 395 },
  },
  MOUND: { x: 400, y: 395 },
  DUGOUT_R: { x: 660, y: 545 }, // scoring runner exit point
  /**
   * Dugout centers + rotation (radians). Each dugout is parallel to its foul
   * line, ~50ft into foul territory.
   *  - VISITOR: 1B-side (right), blue square, rotated to match 1B foul line
   *  - HOME:    3B-side (left),  red square,  rotated to match 3B foul line
   */
  DUGOUT: {
    visitor: { x: 590, y: 480, angle: Math.atan2(-245, 260),  color: 0x991b1b, label: 'Visitor' },
    home:    { x: 210, y: 480, angle: Math.atan2(-245, -260), color: 0x1e3a8a, label: 'Home'    },
    width: 110,
    height: 24,
  },
} as const;

function drawDugout(
  stage: Container,
  spec: { x: number; y: number; angle: number; color: number; label: string },
) {
  const { width, height } = FIELD.DUGOUT;
  const c = new Container();
  c.x = spec.x;
  c.y = spec.y;
  c.rotation = spec.angle;

  const box = new Graphics();
  box
    .rect(-width / 2, -height / 2, width, height)
    .fill(spec.color)
    .stroke({ width: 1.5, color: 0x000000, alpha: 0.6 });
  c.addChild(box);

  const style = new TextStyle({
    fill: 0xffffff,
    fontSize: 12,
    fontFamily: 'monospace',
    fontWeight: 'bold',
    stroke: { color: 0x000000, width: 2 },
  });
  const text = new Text({ text: spec.label, style });
  text.anchor.set(0.5, 0.5);
  // If the dugout rotation would render the text upside-down, flip it 180°
  // so the label always reads left-to-right.
  const a = ((spec.angle % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
  if (a > Math.PI / 2 && a < (3 * Math.PI) / 2) {
    text.rotation = Math.PI;
  }
  c.addChild(text);

  stage.addChild(c);
}

export function drawField(app: Application): { dugoutLayer: Container } {
  const stage = app.stage;
  // Enable z-index sorting so the dugout layer can always be rendered on top
  // of dynamically-added players, regardless of insertion order.
  stage.sortableChildren = true;

  // ── Outfield grass ───────────────────────────────────────────
  const outfield = new Graphics();
  outfield.rect(0, 0, FIELD.W, FIELD.H).fill(0x1a6b1a);
  stage.addChild(outfield);

  // ── Warning track arc ────────────────────────────────────────
  const track = new Graphics();
  track
    .arc(400, 560, 355, Math.PI * 1.78, Math.PI * 3.22)
    .stroke({ width: 22, color: 0x8b6914 });
  stage.addChild(track);

  // ── Foul lines ───────────────────────────────────────────────
  // Extend each foul line through 1B/3B out toward the warning track.
  const foul = new Graphics();
  foul
    .moveTo(400, 545).lineTo(700, 245)  // first base line, extended
    .moveTo(400, 545).lineTo(100, 245)  // third base line, extended
    .stroke({ width: 2, color: 0xffffff });
  stage.addChild(foul);

  // ── Infield dirt diamond ──────────────────────────────
  const infield = new Graphics();
  infield
    .moveTo(400, 545)
    .lineTo(550, 395)
    .lineTo(400, 245)
    .lineTo(250, 395)
    .closePath()
    .fill(0xb8955a);
  stage.addChild(infield);

  // ── Pitcher's mound ──────────────────────────────────────────
  const mound = new Graphics();
  mound.circle(FIELD.MOUND.x, FIELD.MOUND.y, 22).fill(0xb8955a);
  // rubber
  mound.rect(388, 390, 24, 5).fill(0xffffff);
  stage.addChild(mound);

  // ── Base paths (white chalk lines on dirt) ───────────────────
  const paths = new Graphics();
  paths
    .moveTo(400, 545).lineTo(550, 395)
    .lineTo(400, 245).lineTo(250, 395)
    .lineTo(400, 545)
    .stroke({ width: 3, color: 0xffffff, alpha: 0.4 });
  stage.addChild(paths);

  // ── Bases ────────────────────────────────────────────────────
  const bases = new Graphics();
  // 1B, 2B, 3B — white squares rotated 45° (diamonds)
  const halfBase = 9;
  for (const key of ['first', 'second', 'third'] as const) {
    const { x, y } = FIELD.BASE[key];
    bases
      .poly([x, y - halfBase, x + halfBase, y, x, y + halfBase, x - halfBase, y])
      .fill(0xffffff);
  }
  // Home plate — pentagon, point facing the catcher (away from the mound).
  // Pitcher's mound is above home on-screen, so the point goes downward.
  const { x: hx, y: hy } = FIELD.BASE.home;
  bases
    .poly([
      hx - 9, hy - 7,   // top-left corner (faces pitcher)
      hx + 9, hy - 7,   // top-right corner
      hx + 9, hy + 1,   // right shoulder
      hx,     hy + 10,  // tip (points to catcher)
      hx - 9, hy + 1,   // left shoulder
    ])
    .fill(0xffffff);
  stage.addChild(bases);

  // ── Batter's boxes ───────────────────────────────────────────
  const boxes = new Graphics();
  boxes
    .rect(hx - 38, hy - 18, 20, 38)  // left box
    .rect(hx + 18, hy - 18, 20, 38)  // right box
    .stroke({ width: 1, color: 0xffffff, alpha: 0.6 });
  stage.addChild(boxes);
  // ── Dugouts ────────────────────────────────────────────────
  // Drawn into a dedicated layer with a high zIndex so players entering /
  // exiting render _behind_ the dugout box.
  const dugoutLayer = new Container();
  dugoutLayer.zIndex = 1000;
  drawDugout(dugoutLayer, FIELD.DUGOUT.visitor);
  drawDugout(dugoutLayer, FIELD.DUGOUT.home);
  stage.addChild(dugoutLayer);
  return { dugoutLayer };
}
