/**
 * Defensive alignment AI — pre-contact positioning.
 *
 * Computes fielder shifts based on batter tendencies and game
 * situation (infield-in, bunt defense, no-doubles, pull shift).
 */
import type { RunnerEntity, Point2D } from '../entities';
import type { Position } from '@baseballczar/sim-engine';
import { type GameSituation } from './types';

// ═══════════════════════════════════════════════════════════════════
// DEFENSIVE ALIGNMENT — Pre-contact positioning
// ═══════════════════════════════════════════════════════════════════

export type BatterHand = 'L' | 'R';

interface AlignmentResult {
  positions: Partial<Record<Position, Point2D>>;
  label: string;  // for PBP/debugging: "standard", "infield-in", "no-doubles", etc.
}

/**
 * Compute pre-pitch defensive alignment based on game situation.
 * Returns adjusted home positions for fielders that should shift.
 *
 * @param situation - outs, inning, score
 * @param runners - current runners on base
 * @param batterHand - 'L' or 'R' for generic pull tendency
 */
export function getDefensiveAlignment(
  situation: GameSituation,
  runners: RunnerEntity[],
  batterHand: BatterHand = 'R',
): AlignmentResult {
  const occupiedBases = new Set<string>();
  for (const r of runners) {
    if (r.state.type === 'on-base') occupiedBases.add(r.state.base);
  }

  const hasRunnerOnThird = occupiedBases.has('third');
  const hasRunnerOnSecond = occupiedBases.has('second');
  const hasRunnerOnFirst = occupiedBases.has('first');
  const isLate = situation.inning >= 7;
  const isCloseGame = Math.abs(situation.scoreDiff) <= 2;

  // ── Infield-in: runner on 3B, fewer than 2 outs ──────────────
  // Bring infield in 20 ft to cut off the run at the plate.
  if (hasRunnerOnThird && situation.outs < 2) {
    const inDelta = 20;
    return {
      positions: {
        B1: { x: 50,   y: 85 - inDelta },
        B2: { x: 35,   y: 130 - inDelta },
        SS: { x: -35,  y: 130 - inDelta },
        B3: { x: -50,  y: 85 - inDelta },
      },
      label: 'infield-in',
    };
  }

  // ── Bunt defense: runner on 1B or 2B, 0 outs ─────────────────
  // P/1B/3B creep forward to field the bunt.
  if ((hasRunnerOnFirst || hasRunnerOnSecond) && situation.outs === 0) {
    return {
      positions: {
        P:  { x: 0,    y: 50 },   // pitcher creeps toward plate
        B1: { x: 40,   y: 65 },   // 1B plays in
        B3: { x: -40,  y: 65 },   // 3B plays in
      },
      label: 'bunt-defense',
    };
  }

  // ── No-doubles: late in close game, OF plays deep ─────────────
  // Outfielders push back ~25 ft to prevent extra bases.
  if (isLate && isCloseGame && !hasRunnerOnThird) {
    const deepDelta = 25;
    return {
      positions: {
        LF: { x: -136, y: 227 + deepDelta },
        CF: { x:    0, y: 295 + deepDelta },
        RF: { x:  136, y: 227 + deepDelta },
      },
      label: 'no-doubles',
    };
  }

  // ── Pull shift: generic L/R batter tendency ───────────────────
  // Shift the infield and outfield toward the pull side.
  // L batter pulls to right → shift right. R batter pulls left → shift left.
  const pullShift = batterHand === 'L' ? 12 : -12;  // ft of lateral shift
  const ofPullShift = batterHand === 'L' ? 20 : -20;

  return {
    positions: {
      B2: { x: 35 + pullShift,   y: 130 },
      SS: { x: -35 + pullShift,  y: 130 },
      LF: { x: -136 + ofPullShift, y: 227 },
      RF: { x:  136 + ofPullShift, y: 227 },
    },
    label: 'pull-shift',
  };
}

// ─── Defensive positioning / shifts ──────────────────────────────

export interface DefensiveAlignment {
  /** Adjusted positions for infielders (key = position, value = feet offset from default). */
  shifts: Map<string, Point2D>;
  /** Description for PBP. */
  description: string;
}

/**
 * Compute defensive positioning adjustments based on the batter.
 * Returns position offsets that the tick engine applies to fielder
 * home positions before the at-bat.
 *
 * Shift types:
 *   - Pull shift: against power pull hitters (move IF/OF to pull side)
 *   - No-doubles: with runner on 2B, OF plays deeper
 *   - IF-in: runner on 3B, less than 2 outs, infield draws in
 */
export function computeDefensiveAlignment(
  batterHand: 'L' | 'R' | 'S',
  batterSkills: { power: number; dhr: number; speed: number },
  situation: GameSituation,
  runnersOnBase: string[],  // ['first', 'second', 'third']
): DefensiveAlignment {
  const shifts = new Map<string, Point2D>();
  const descriptions: string[] = [];

  // Pull shift: power hitter with pull tendency
  if (batterSkills.power >= 7) {
    const pullSide = batterHand === 'L' ? 1 : -1;  // L pulls to right, R pulls to left

    // Shift SS and B2 toward pull side
    shifts.set('SS', { x: pullSide * 20, y: 0 });
    shifts.set('B2', { x: pullSide * 15, y: 0 });
    // Shift B3 to SS position if extreme pull hitter
    if (batterSkills.power >= 9) {
      shifts.set('B3', { x: pullSide * 30, y: 10 });
      descriptions.push(`Full pull shift (${batterHand}H power)`);
    } else {
      descriptions.push(`Partial shift (${batterHand}H power)`);
    }
  }

  // No-doubles defense: runner on 2B, play OF deeper
  if (runnersOnBase.includes('second')) {
    shifts.set('LF', { x: 0, y: 15 });
    shifts.set('CF', { x: 0, y: 15 });
    shifts.set('RF', { x: 0, y: 15 });
    descriptions.push('No-doubles depth');
  }

  // Infield in: runner on 3B, less than 2 outs
  if (runnersOnBase.includes('third') && situation.outs < 2) {
    const inDraw = -25;  // 25 ft closer to home
    shifts.set('B1', { x: 0, y: inDraw });
    shifts.set('B2', {
      x: (shifts.get('B2')?.x ?? 0),
      y: inDraw,
    });
    shifts.set('SS', {
      x: (shifts.get('SS')?.x ?? 0),
      y: inDraw,
    });
    shifts.set('B3', {
      x: (shifts.get('B3')?.x ?? 0),
      y: inDraw,
    });
    descriptions.push('Infield in (runner on 3B)');
  }

  return {
    shifts,
    description: descriptions.length > 0
      ? descriptions.join(' + ')
      : 'Standard alignment',
  };
}
