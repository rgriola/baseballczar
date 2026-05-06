// Last touched by agent: 2026-05-06T12:36:52Z
/**
 * Phase A refactor — pure situational reclassification of an at-bat.
 *
 * Lifted out of `simulateHalfInning` so the rules are testable in
 * isolation. Given the *raw* at-bat result from the converger /
 * hit classifier, return what the result should be after applying:
 *
 *   • Infield Fly Rule   (caller checks separately, see rules/infieldFly)
 *   • Double Play         — ground-out + r1 + <2 outs + MIF/B3 fielded
 *   • Fielder's Choice   — ground-out + r1 + <2 outs + DP roll fails
 *   • Sacrifice Fly       — fly-out + r3 + <2 outs + OF caught the ball
 *
 * Pure: no mutation, no I/O. The caller is responsible for applying
 * the result (mutating bases, recording outs/runs).
 */
import type { AtBatResult } from '../types';
import type { Position } from '../config';
import { CONFIG } from '../config';
import type { Rng } from '../rng';

export interface SituationalContext {
  /** Outs BEFORE this at-bat resolves. */
  outs: number;
  /** Pre-play occupancy [r1, r2, r3]. Only existence matters here. */
  bases: readonly (unknown | null)[];
  /** Position that fielded the ball, if any. */
  fieldedBy?: Position;
  /** Defense skill of the fielder (for DP probability). Defaults to 5. */
  fielderDefense?: number;
  /** Defense lead/deficit before this play. Positive means defense leads. */
  defenseLeadDeficit?: number;
}

/**
 * Returns the (possibly reclassified) at-bat result. If no
 * reclassification applies the original `result` is returned unchanged.
 */
export function classifySituationalOut(
  result: AtBatResult,
  ctx: SituationalContext,
  rng: Rng,
): AtBatResult {
  const runnerOn1 = ctx.bases[0] != null;
  const runnerOn3 = ctx.bases[2] != null;
  const def = ctx.fielderDefense ?? 5;
  const defenseLeadDeficit = ctx.defenseLeadDeficit ?? 0;

  // P1 target-base decision tree for infield grounders:
  // - 2 outs: take the easy out at 1B.
  // - R3 with < 2 outs: look runner back, still take 1B.
  // - Up big (>=5) with 0 outs: prioritize the sure out at 1B.
  if (result === 'ground-out') {
    if (ctx.outs === 2) return result;
    if (runnerOn3 && ctx.outs < 2) return result;
    if (defenseLeadDeficit >= 5 && ctx.outs === 0) return result;
  }

  if (result === 'ground-out' && runnerOn1 && ctx.outs < 2) {
    // DPs realistically only on grounders to MIF or 3B (6-4-3, 4-6-3, 5-4-3).
    const dpFeasible =
      ctx.fieldedBy === 'SS' || ctx.fieldedBy === 'B2' || ctx.fieldedBy === 'B3';
    const dpProb = dpFeasible
      ? CONFIG.doublePlay.baseProb + (def - 5) * CONFIG.doublePlay.skillLeverage
      : 0;
    if (rng.bool(Math.max(0, Math.min(0.85, dpProb)))) return 'double-play';
    if (rng.bool(CONFIG.baserunning.fcProb)) return 'fielders-choice';
    return result;
  }

  if (result === 'fly-out' && runnerOn3 && ctx.outs < 2) {
    const isOFfly =
      ctx.fieldedBy === 'LF' || ctx.fieldedBy === 'CF' || ctx.fieldedBy === 'RF';
    if (isOFfly && rng.bool(CONFIG.baserunning.sacFlyTagProb)) return 'sac-fly';
  }

  return result;
}
