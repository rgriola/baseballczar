/**
 * Standard fielder positions in feet, origin = home plate.
 * Used to compute who converges on a batted ball.
 */
import type { Position } from '../config';

export const FIELDER_POSITIONS_FT: Record<Position, { x: number; y: number }> = {
  P:  { x: 0,    y: 60.5 },
  C:  { x: 0,    y: -3 },
  B1: { x: 50,   y: 85 },
  B2: { x: 35,   y: 130 },
  SS: { x: -35,  y: 130 },
  B3: { x: -50,  y: 85 },
  LF: { x: -130, y: 280 },
  CF: { x: 0,    y: 320 },
  RF: { x: 130,  y: 280 },
};
