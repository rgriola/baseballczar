/**
 * Standard fielder positions in feet, origin = home plate.
 * Used to compute who converges on a batted ball.
 *
 * Outfielders play roughly 50–75 ft off the wall at their angle, with
 * the corners pulled toward the lines so the LCF and RCF gaps are open.
 * That's where MLB doubles drop in. Balls down the lines that get past
 * the corner OF skip into the corner and become triples after a long
 * chase + relay throw home.
 *
 * Park dims (CONFIG.park): LF/RF line 320 ft, LCF/RCF 375 ft, CF 405 ft.
 *   LF at (−140, 235): ~273 ft from home @ angle −31°; wall here
 *                       ≈ 350 ft → ≈77 ft off wall.
 *   CF at (   0, 335): 335 ft straightaway; wall 405 ft → 70 ft off wall.
 *   RF at ( 140, 235): mirror of LF.
 */
import type { Position } from '../config';

export const FIELDER_POSITIONS_FT: Record<Position, { x: number; y: number }> = {
  P:  { x: 0,    y: 61 },
  C:  { x: 0,    y: -3 },
  B1: { x: 50,   y: 85 },
  B2: { x: 35,   y: 130 },
  SS: { x: -35,  y: 130 },
  B3: { x: -50,  y: 85 },
  // Corners pulled in toward the lines (~31°) and shallower so they have
  // to chase balls in the gaps and down the lines. CF straightaway, deep
  // enough to cover both gaps but not so deep he eats every fly ball.
  LF: { x: -140, y: 235 },
  CF: { x:    0, y: 335 },
  RF: { x:  140, y: 235 },
};

