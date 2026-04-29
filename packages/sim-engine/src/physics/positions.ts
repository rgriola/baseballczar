/**
 * Standard fielder positions in feet, origin = home plate.
 * Used to compute who converges on a batted ball.
 *
 * Outfielders are spaced wider than the simple LF/CF/RF triangle so the
 * LCF and RCF gaps exist — that's where MLB doubles drop in. Under the
 * symmetric ±45° spray convention the fair wedge is small enough that a
 * tight triangle covered everything.
 */
import type { Position } from '../config';

export const FIELDER_POSITIONS_FT: Record<Position, { x: number; y: number }> = {
  P:  { x: 0,    y: 61 },
  C:  { x: 0,    y: -3 },
  B1: { x: 50,   y: 85 },
  B2: { x: 35,   y: 130 },
  SS: { x: -35,  y: 130 },
  B3: { x: -50,  y: 85 },
  // Corner OFs play wide toward the lines; CF plays deep. Gaps in LCF
  // (~ -80 ft, 290 ft) and RCF (~ +80 ft, 290 ft) are open.
  LF: { x: -170, y: 280 },
  CF: { x: 0,    y: 330 },
  RF: { x: 170,  y: 280 },
};
