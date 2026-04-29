/**
 * Render the static MLB field: grass, dirt, foul lines, bases, mound,
 * batter's/catcher's boxes, and outfield wall.
 *
 * Design rules:
 *   - All geometry is defined in FEET in `FIELD_SPEC` and converted to
 *     pixels via the `FieldTransform`. The field always lines up with the
 *     engine coordinate space at any zoom level.
 *   - Helpers are organized by VISUAL LAYER (back-to-front). `buildField`
 *     just composes them in z-order.
 *   - This file is the canonical "neutral park" template. Stadium-specific
 *     elements (true wall dimensions, fences, dugouts, props) should layer
 *     on top of this in a separate module.
 */
import { Container, Graphics, Text } from 'pixi.js';
import {
  type FieldTransform,
  type CanvasSize,
  ftToPx,
  ftToPxXY,
} from '../coords';
import { BASE_COORDS_FT, FIELDER_POSITIONS_FT } from '@baseballczar/sim-engine';

// ─────────────────────────────────────────────────────────────
// Style palette
// ─────────────────────────────────────────────────────────────

export interface FieldStyle {
  grassDark: number;
  grassLight: number;
  dirt: number;
  baseLine: number;
  base: number;
  wall: number;
  wallTop: number;
  text: number;
  dugoutFill: number;
  dugoutStroke: number;
}

export const NIGHT_STYLE: FieldStyle = {
  grassDark: 0x0e3a1f,
  grassLight: 0x18602f,
  dirt: 0x6b4a2b,
  baseLine: 0xf5efe6,
  base: 0xffffff,
  wall: 0x1c1c2e,
  wallTop: 0xf5d76e,
  text: 0xe6f0e6,
  dugoutFill: 0x18181f,
  dugoutStroke: 0x3a3a48,
};

// ─────────────────────────────────────────────────────────────
// Field spec — all measurements in feet (or radians where noted).
// Sourced from MLB rulebook + standard groundskeeping practice.
// ─────────────────────────────────────────────────────────────

const FIELD_SPEC = {
  /** Symmetric outfield wall radius (rough — not park-specific). */
  wallRadiusFt: 380,
  /** Wall thickness as a band of feet inside the radius. */
  wallThicknessFt: 4,

  /** Pitcher's rubber distance from home (apex), feet. */
  rubberFt: 60.5,
  /** Mound dirt circle radius. */
  moundRadiusFt: 9,
  /** Rubber dot for visual reference. */
  rubberDotFt: 0.5,

  /** Infield skin arc radius, centered on the rubber. */
  infieldArcRadiusFt: 95,
  /** Tangent x of arc with foul lines (intersection of y=±x with arc). */
  infieldArcTangentFt: 90.2,
  /** Dirt cutout radius around 1B/2B/3B. */
  baseCutoutRadiusFt: 13,
  /** Dirt cutout radius around home plate (catcher's working area). */
  homeCutoutRadiusFt: 16,
  /** Home cutout center is shifted toward catcher this many feet. */
  homeCutoutOffsetFt: 3,
  /** Width of the dirt running paths between bases. */
  pathWidthFt: 6,

  /** Side length of a base (1B/2B/3B), MLB rule since 2023. */
  baseSizeFt: 1.5, // 18"

  /** Home plate dimensions. */
  plateHalfWidthFt: 0.708, // 8.5"
  plateDepthFt: 1.417,     // 17" apex → front edge

  /** Foul line stroke width (4" chalk, MLB rule). */
  foulWidthIn: 4,
  /** Chalk stroke width for batter's/catcher's boxes (~3"). */
  chalkWidthIn: 3,

  /** Batter's box: enlarged for legibility (MLB regulation is 4 × 6 ft;
   *  we draw a touch larger so the boxes read clearly relative to the
   *  17" plate at typical zoom). Inner edge sits 6" off plate side. */
  batterBoxWidthFt: 5.5,
  batterBoxLengthFt: 7,
  batterBoxOffsetFt: 0.5, // distance from plate side edge to box inner edge

  /** Catcher's box: enlarged similarly (MLB regulation 43" × 8 ft). */
  catcherBoxWidthIn: 58,
  catcherBoxLengthFt: 9,

  /** Dugouts (visual only): rectangles parallel to the foul line, in foul
   *  territory. `lineDist` = distance along the foul line from home; `perp`
   *  = perpendicular distance outward from the line into foul territory. */
  dugoutLineDistFt: 50,
  dugoutPerpDistFt: 65,
  dugoutLengthFt: 60,
  dugoutDepthFt: 14,
} as const;

// Engine angles for the foul lines, measured from +x axis.
// 1B foul line at +45°, 3B foul line at +135° (engine has +y toward CF).
const FOUL_ANGLE = {
  first: Math.PI * 0.25,
  third: Math.PI * 0.75,
} as const;

type Px = { x: number; y: number };
type BasePx = { home: Px; first: Px; second: Px; third: Px };

// ─────────────────────────────────────────────────────────────
// Tiny geometry helpers
// ─────────────────────────────────────────────────────────────

/** Sample a circular arc in engine feet → screen px. */
function arcInFt(
  cx: number, cy: number, rFt: number,
  angA: number, angB: number, segments: number,
  t: FieldTransform,
): Px[] {
  const out: Px[] = [];
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const a = angA + (angB - angA) * u;
    out.push(ftToPxXY(cx + Math.cos(a) * rFt, cy + Math.sin(a) * rFt, t));
  }
  return out;
}

/** Append an axis-aligned rect (defined in engine feet) to a Graphics. */
function rectFt(g: Graphics, x1: number, y1: number, x2: number, y2: number, t: FieldTransform): void {
  const a = ftToPxXY(x1, y1, t);
  const b = ftToPxXY(x2, y2, t);
  g.rect(Math.min(a.x, b.x), Math.min(a.y, b.y),
         Math.abs(b.x - a.x), Math.abs(b.y - a.y));
}

/** Inches → pixel stroke width with a 1px floor. */
function inchesToPx(inches: number, t: FieldTransform, floorPx = 1): number {
  return Math.max(floorPx, (inches / 12) * t.scale);
}

// ─────────────────────────────────────────────────────────────
// Layer builders (back → front)
// ─────────────────────────────────────────────────────────────

function drawBackground(size: CanvasSize, style: FieldStyle): Graphics {
  const g = new Graphics();
  g.rect(0, 0, size.width, size.height).fill(style.grassDark);
  return g;
}

/** Lighter-green wedge for fair territory, bounded by foul lines + wall arc. */
function drawFairWedge(t: FieldTransform, style: FieldStyle): Graphics {
  const g = new Graphics();
  const home = ftToPxXY(0, 0, t);
  const arc = arcInFt(0, 0, FIELD_SPEC.wallRadiusFt,
                      FOUL_ANGLE.third, FOUL_ANGLE.first, 32, t);
  const pts = [home, ...arc, home];
  g.poly(pts.flatMap(p => [p.x, p.y])).fill(style.grassLight);
  return g;
}

/** Outfield wall ring (yellow top stripe). */
function drawWall(t: FieldTransform, style: FieldStyle): Graphics {
  const g = new Graphics();
  const outer = arcInFt(0, 0, FIELD_SPEC.wallRadiusFt,
                        FOUL_ANGLE.third, FOUL_ANGLE.first, 32, t);
  const inner = arcInFt(0, 0, FIELD_SPEC.wallRadiusFt - FIELD_SPEC.wallThicknessFt,
                        FOUL_ANGLE.first, FOUL_ANGLE.third, 32, t);
  g.poly([...outer, ...inner].flatMap(p => [p.x, p.y])).fill(style.wallTop);
  return g;
}

/** Infield grass diamond between the four bases. */
function drawInfieldGrass(bases: BasePx, style: FieldStyle): Graphics {
  const g = new Graphics();
  g.poly([
    bases.home.x,   bases.home.y,
    bases.first.x,  bases.first.y,
    bases.second.x, bases.second.y,
    bases.third.x,  bases.third.y,
  ]).fill(style.grassLight);
  return g;
}

/**
 * Infield dirt "skin": all dirt outside the grass diamond — per-base
 * cutouts, home cutout, running paths between bases, and the 95-ft arc
 * behind the mound (with the area between arc and base paths filled).
 */
function drawInfieldSkin(bases: BasePx, t: FieldTransform, style: FieldStyle): Graphics {
  const g = new Graphics();

  // Per-base sliding pits.
  const baseR = Math.max(8, FIELD_SPEC.baseCutoutRadiusFt * t.scale);
  for (const pt of [bases.first, bases.second, bases.third]) {
    g.circle(pt.x, pt.y, baseR).fill(style.dirt);
  }

  // Home cutout (catcher's working area), shifted slightly behind the plate.
  const homeCut = ftToPxXY(0, -FIELD_SPEC.homeCutoutOffsetFt, t);
  g.circle(homeCut.x, homeCut.y,
           Math.max(10, FIELD_SPEC.homeCutoutRadiusFt * t.scale))
    .fill(style.dirt);

  // 95-ft arc behind the mound. Arc center = rubber, tangent points are
  // the intersections of the arc with each foul line (y = ±x).
  const arcCenter = ftToPxXY(0, FIELD_SPEC.rubberFt, t);
  const arcR = FIELD_SPEC.infieldArcRadiusFt * t.scale;
  const tan = FIELD_SPEC.infieldArcTangentFt;
  const p1B = ftToPxXY( tan, tan, t);
  const p3B = ftToPxXY(-tan, tan, t);
  const a1 = Math.atan2(p1B.y - arcCenter.y, p1B.x - arcCenter.x);
  const a3 = Math.atan2(p3B.y - arcCenter.y, p3B.x - arcCenter.x);
  const segments = 48;
  const arcPts: number[] = [];
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const ang = a1 + (a3 - a1) * u;
    arcPts.push(arcCenter.x + Math.cos(ang) * arcR,
                arcCenter.y + Math.sin(ang) * arcR);
  }

  // Skin polygon: arc (p1B → p3B) → 3B → 2B → 1B (closes back to p1B).
  g.poly([
    ...arcPts,
    bases.third.x,  bases.third.y,
    bases.second.x, bases.second.y,
    bases.first.x,  bases.first.y,
  ]).fill(style.dirt);

  // Running paths between bases (drawn on top of the skin so circles blend).
  const pathPx = Math.max(4, FIELD_SPEC.pathWidthFt * t.scale);
  const links: [Px, Px][] = [
    [bases.home,   bases.first],
    [bases.home,   bases.third],
    [bases.third,  bases.second],
    [bases.second, bases.first],
  ];
  for (const [a, b] of links) {
    g.moveTo(a.x, a.y).lineTo(b.x, b.y)
      .stroke({ color: style.dirt, width: pathPx });
  }

  return g;
}

/** Pitcher's mound (dirt circle + small rubber dot). */
function drawMound(t: FieldTransform, style: FieldStyle): Graphics {
  const g = new Graphics();
  const c = ftToPxXY(0, FIELD_SPEC.rubberFt, t);
  g.circle(c.x, c.y, FIELD_SPEC.moundRadiusFt * t.scale).fill(style.dirt);
  g.circle(c.x, c.y, FIELD_SPEC.rubberDotFt * t.scale).fill(style.baseLine);
  return g;
}

/** 4" chalk foul lines, offset so the entire chalk is in fair territory. */
function drawFoulLines(t: FieldTransform, style: FieldStyle): Graphics {
  const g = new Graphics();
  const home = ftToPxXY(0, 0, t);
  const r = FIELD_SPEC.wallRadiusFt;
  const fl1 = ftToPxXY(Math.cos(FOUL_ANGLE.first) * r, Math.sin(FOUL_ANGLE.first) * r, t);
  const fl3 = ftToPxXY(Math.cos(FOUL_ANGLE.third) * r, Math.sin(FOUL_ANGLE.third) * r, t);
  const w = inchesToPx(FIELD_SPEC.foulWidthIn, t);
  // Inward (toward fair) screen-space normals:
  //   1B line direction (screen) = (+1,−1)/√2 → inward normal = (−1,−1)/√2
  //   3B line direction (screen) = (−1,−1)/√2 → inward normal = (+1,−1)/√2
  const inset = (w / 2) * Math.SQRT1_2;
  g.moveTo(home.x - inset, home.y - inset).lineTo(fl1.x - inset, fl1.y - inset)
   .moveTo(home.x + inset, home.y - inset).lineTo(fl3.x + inset, fl3.y - inset)
   .stroke({ color: style.baseLine, width: w });
  return g;
}

/** Two batter's boxes + catcher's box, chalk outlines per MLB diagram. */
function drawBatterBoxes(t: FieldTransform, style: FieldStyle): Graphics {
  const g = new Graphics();
  const innerX = FIELD_SPEC.plateHalfWidthFt + FIELD_SPEC.batterBoxOffsetFt;
  const outerX = innerX + FIELD_SPEC.batterBoxWidthFt;
  // Per MLB: back line of batter's box is 3 ft behind the back point of
  // home plate (apex); front line is 3 ft in front of apex. So the box is
  // centered on the plate apex (engine origin), not on the plate's depth.
  const halfLen = FIELD_SPEC.batterBoxLengthFt / 2;
  const frontY  =  halfLen; // toward pitcher
  const backY   = -halfLen; // toward catcher

  rectFt(g,  innerX, backY,  outerX, frontY, t); // RH box
  rectFt(g, -innerX, backY, -outerX, frontY, t); // LH box

  // Catcher's box: starts at batter's-box back edge, extends toward catcher.
  const cHalfW = FIELD_SPEC.catcherBoxWidthIn / 12 / 2;
  const cBackY = backY - FIELD_SPEC.catcherBoxLengthFt;
  rectFt(g, -cHalfW, cBackY, cHalfW, backY, t);

  g.stroke({
    color: style.baseLine,
    width: inchesToPx(FIELD_SPEC.chalkWidthIn, t),
    alpha: 0.85,
  });
  return g;
}

/**
 * Bases: home plate pentagon + diamond-rotated 1B/2B/3B squares.
 * 1B/3B are nudged inward in pixel space so the outer corner sits on the
 * foul line at any zoom (independent of the base's min-pixel floor).
 */
function drawBases(bases: BasePx, t: FieldTransform, style: FieldStyle): Graphics {
  const g = new Graphics();
  const baseSizePx = Math.max(6, FIELD_SPEC.baseSizeFt * t.scale);
  const halfDiagPx = baseSizePx * Math.SQRT1_2;

  const drawDiamond = (cx: number, cy: number) => {
    g.poly([
      cx,                cy - halfDiagPx,
      cx + halfDiagPx,   cy,
      cx,                cy + halfDiagPx,
      cx - halfDiagPx,   cy,
    ]).fill(style.base);
  };

  // Inset 1B/3B so the outer corner sits on the foul line at any zoom.
  // Inward normals (screen px): 1B = (−1,−1)/√2, 3B = (+1,−1)/√2.
  const inset = halfDiagPx * Math.SQRT1_2;
  drawDiamond(bases.first.x  - inset, bases.first.y  - inset);
  drawDiamond(bases.second.x, bases.second.y);
  drawDiamond(bases.third.x  + inset, bases.third.y  - inset);

  // Home plate pentagon. Apex at engine origin (foul lines meet here);
  // the two 12" edges run along the foul lines; the 17" front edge faces
  // the pitcher. Boost size to match the bases' min-pixel floor when zoomed out.
  const naturalPlatePx = (FIELD_SPEC.plateHalfWidthFt * 2) * t.scale;
  const PS = Math.max(1, baseSizePx / Math.max(0.0001, naturalPlatePx));
  const w = FIELD_SPEC.plateHalfWidthFt * PS;
  const d = FIELD_SPEC.plateDepthFt * PS;
  const platePx = [
    { x:  0, y:  0 }, // apex
    { x:  w, y:  w }, // right shoulder (along 1B foul line)
    { x:  w, y:  d }, // front-right
    { x: -w, y:  d }, // front-left
    { x: -w, y:  w }, // left shoulder (along 3B foul line)
  ].flatMap(p => {
    const px = ftToPxXY(p.x, p.y, t);
    return [px.x, px.y];
  });
  g.poly(platePx).fill(style.base);

  return g;
}

/** Faint position labels above each fielder spot (LF/CF/RF/1B/2B/SS/3B). */
function drawPositionLabels(t: FieldTransform, style: FieldStyle): Container {
  const layer = new Container();
  layer.alpha = 0.35;
  for (const [pos, ft] of Object.entries(FIELDER_POSITIONS_FT)) {
    if (pos === 'P' || pos === 'C') continue;
    const px = ftToPx(ft, t);
    const txt = new Text({
      text: pos,
      style: { fill: style.text, fontSize: 9, fontFamily: 'system-ui' },
    });
    txt.anchor.set(0.5);
    txt.position.set(px.x, px.y - 14);
    layer.addChild(txt);
  }
  return layer;
}

// ─────────────────────────────────────────────────────────────
// Public entry point
// ─────────────────────────────────────────────────────────────

/**
 * Build the static field container, composed back-to-front:
 *   1. dark grass background
 *   2. lighter fair-territory wedge
 *   3. outfield wall stripe
 *   4. infield grass diamond
 *   5. infield dirt skin (cutouts, paths, arc)
 *   6. pitcher's mound
 *   7. foul lines
 *   8. batter's & catcher's boxes
 *   9. bases (home plate pentagon + diamonds)
 *  10. faint position labels
 */
export function buildField(
  size: CanvasSize,
  t: FieldTransform,
  style: FieldStyle = NIGHT_STYLE,
): { root: Container } {
  const root = new Container();

  // Pre-compute base coordinates in screen space — used by several layers.
  const bases: BasePx = {
    home:   ftToPx(BASE_COORDS_FT.home,   t),
    first:  ftToPx(BASE_COORDS_FT.first,  t),
    second: ftToPx(BASE_COORDS_FT.second, t),
    third:  ftToPx(BASE_COORDS_FT.third,  t),
  };

  root.addChild(drawBackground(size, style));
  root.addChild(drawFairWedge(t, style));
  root.addChild(drawWall(t, style));
  root.addChild(drawInfieldGrass(bases, style));
  root.addChild(drawInfieldSkin(bases, t, style));
  root.addChild(drawMound(t, style));
  root.addChild(drawFoulLines(t, style));
  root.addChild(drawBatterBoxes(t, style));
  root.addChild(drawBases(bases, t, style));
  root.addChild(drawDugouts(t, style));
  root.addChild(drawPositionLabels(t, style));

  return { root };
}

// ─── Dugout helpers (also exported for the scene to send out players to) ───

/** Engine-coords basis for one foul-line side. `homeSide` true = 1B side. */
function dugoutBasis(homeSide: boolean) {
  const sx = homeSide ? 1 : -1;
  // u: unit vector along the foul line away from home (toward 1B/3B)
  // v: unit vector perpendicular to u, pointing OUTWARD into foul territory
  const u = { x: sx / Math.SQRT2, y: 1 / Math.SQRT2 };
  const v = { x: sx / Math.SQRT2, y: -1 / Math.SQRT2 };
  return { u, v };
}

/** Dugout center in engine feet. Home team uses 1B side, away uses 3B side. */
export function dugoutCenterFt(homeSide: boolean): { x: number; y: number } {
  const { u, v } = dugoutBasis(homeSide);
  const d = FIELD_SPEC.dugoutLineDistFt;
  const p = FIELD_SPEC.dugoutPerpDistFt;
  return { x: d * u.x + p * v.x, y: d * u.y + p * v.y };
}

/**
 * A point inside the dugout for a player to settle at. `alongOffsetFt`
 * spreads players along the bench (negative = closer to home, positive =
 * away from home); `depthBiasFt` pushes them toward the back wall (positive
 * = deeper into foul territory). Both are clamped to stay inside the box.
 */
export function dugoutSpotFt(
  homeSide: boolean,
  alongOffsetFt = 0,
  depthBiasFt = 2.5,
): { x: number; y: number } {
  const { u, v } = dugoutBasis(homeSide);
  const c = dugoutCenterFt(homeSide);
  const hl = FIELD_SPEC.dugoutLengthFt / 2 - 1.5;
  const hd = FIELD_SPEC.dugoutDepthFt / 2 - 1.2;
  const a = Math.max(-hl, Math.min(hl, alongOffsetFt));
  const d = Math.max(-hd, Math.min(hd, depthBiasFt));
  return { x: c.x + a * u.x + d * v.x, y: c.y + a * u.y + d * v.y };
}

/** Engine-feet coords of the four dugout corners (for drawing). */
function dugoutCornersFt(homeSide: boolean): { x: number; y: number }[] {
  const { u, v } = dugoutBasis(homeSide);
  const c = dugoutCenterFt(homeSide);
  const hl = FIELD_SPEC.dugoutLengthFt / 2;
  const hd = FIELD_SPEC.dugoutDepthFt / 2;
  return [
    { x: c.x + hl * u.x + hd * v.x, y: c.y + hl * u.y + hd * v.y },
    { x: c.x + hl * u.x - hd * v.x, y: c.y + hl * u.y - hd * v.y },
    { x: c.x - hl * u.x - hd * v.x, y: c.y - hl * u.y - hd * v.y },
    { x: c.x - hl * u.x + hd * v.x, y: c.y - hl * u.y + hd * v.y },
  ];
}

function drawDugouts(t: FieldTransform, style: FieldStyle): Graphics {
  const g = new Graphics();
  for (const homeSide of [true, false]) {
    const corners = dugoutCornersFt(homeSide).map(c => ftToPxXY(c.x, c.y, t));
    const flat: number[] = [];
    for (const c of corners) flat.push(c.x, c.y);
    g.poly(flat).fill(style.dugoutFill).stroke({
      color: style.dugoutStroke, width: 1.5, alpha: 0.9,
    });
  }
  return g;
}
