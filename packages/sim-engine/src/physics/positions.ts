/**
 * Standard fielder positions in feet, origin = home plate.
 * Used to compute who converges on a batted ball.
 *
 * Outfielders play 75 ft from the wall at their angle. Corners are
 * pulled toward the lines so the LCF and RCF gaps are open — that's
 * where MLB doubles drop in.
 *
 * Park dims (CONFIG.park): LF/RF line 320 ft, LCF/RCF 375 ft, CF 405 ft.
 *   Wall at LF angle (-31°): ≈347 ft → OF at 272 ft from home.
 *   Wall at CF angle (  0°): 405 ft  → OF at 330 ft from home.
 *   Wall at RF angle (+31°): ≈347 ft → OF at 272 ft from home.
 *
 * x = dist × sin(angle),  y = dist × cos(angle)
 *   LF: 272 × sin(-31°) = -140,  272 × cos(-31°) = 233
 *   CF: 330 × sin(0°) = 0,       330 × cos(0°) = 330
 *   RF: 272 × sin(+31°) = +140,  272 × cos(+31°) = 233
 */
import type { Position } from '../config';

export const FIELDER_POSITIONS_FT: Record<Position, { x: number; y: number }> = {
  P:  { x: 0,    y: 61 },
  C:  { x: 0,    y: -3 },
  B1: { x: 50,   y: 85 },
  B2: { x: 35,   y: 130 },
  SS: { x: -35,  y: 130 },
  B3: { x: -50,  y: 85 },
  // ~85 ft from the wall at each fielder's natural spray angle.
  // LF/RF at ~265 ft from home; CF at ~295 ft. Realistic MLB depth
  // gives room to go back on drives while covering the shallow zone.
  LF: { x: -136, y: 227 },
  CF: { x:    0, y: 295 },
  RF: { x:  136, y: 227 },
};

