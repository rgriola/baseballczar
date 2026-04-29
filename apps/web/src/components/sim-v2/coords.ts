/**
 * Coordinate transforms between engine-native feet and Pixi screen pixels.
 *
 * Engine: origin = home plate, +x to right, +y to center field (feet).
 * Pixi:   origin = top-left, +x right, +y down (pixels).
 *
 * Layout target (800×600):
 *   - home plate near bottom-center
 *   - CF wall near top
 *   - 1B to lower-right, 3B to lower-left
 */

export interface CanvasSize {
  width: number;
  height: number;
}

export interface FieldTransform {
  /** Pixels per foot. */
  scale: number;
  /** Pixel x where engine x = 0 (home plate column). */
  homeX: number;
  /** Pixel y where engine y = 0 (home plate row). */
  homeY: number;
}

/**
 * Build a transform that fits the playable region into the canvas.
 * `maxFt` is the deepest fly-ball distance we want to keep on screen
 * (default 410 ft — comfortable for any HR).
 */
export function makeTransform(
  size: CanvasSize,
  opts: { maxFt?: number; bottomPadPx?: number; topPadPx?: number } = {},
): FieldTransform {
  const maxFt = opts.maxFt ?? 410;
  const bottomPad = opts.bottomPadPx ?? 55;
  const topPad = opts.topPadPx ?? 30;
  const usableY = size.height - bottomPad - topPad;
  // Width constraint: foul lines extend ~280 ft to each side at the wall.
  // Keep both axes equal-scale so the field looks natural.
  const usableX = size.width - 40;
  const scaleY = usableY / maxFt;
  const scaleX = (usableX / 2) / 290;
  const scale = Math.min(scaleX, scaleY);
  return {
    scale,
    homeX: size.width / 2,
    homeY: size.height - bottomPad,
  };
}

export function ftToPx(
  pt: { x: number; y: number },
  t: FieldTransform,
): { x: number; y: number } {
  return {
    x: t.homeX + pt.x * t.scale,
    y: t.homeY - pt.y * t.scale,
  };
}

export function ftToPxXY(
  x: number,
  y: number,
  t: FieldTransform,
): { x: number; y: number } {
  return { x: t.homeX + x * t.scale, y: t.homeY - y * t.scale };
}

/** Linear interpolation between two engine-feet points. */
export function lerpFt(
  a: { x: number; y: number },
  b: { x: number; y: number },
  u: number,
): { x: number; y: number } {
  return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
}

/**
 * Parabolic altitude in feet at progress u (0..1) for an arc that peaks
 * at `apexFt`. Returns 0 at the endpoints, apexFt at u=0.5.
 */
export function arcHeightFt(u: number, apexFt: number): number {
  return 4 * u * (1 - u) * apexFt;
}

/**
 * Parabolic arc altitude (for fly balls) — adds a faux z by lifting the
 * sprite a bit upward in screen space. Returns extra px to subtract from
 * screen y at progress u (0..1) given apexFt. Multiplied by 0.6 so the
 * lift looks like a camera tilted slightly toward the field rather than a
 * pure top-down bounce.
 */
export function arcLiftPx(u: number, apexFt: number, t: FieldTransform): number {
  return arcHeightFt(u, apexFt) * t.scale * 0.6;
}
