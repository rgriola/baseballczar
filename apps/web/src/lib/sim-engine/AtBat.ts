import type { SkillThresholds } from './types';
import { AtBatOutcome } from './types';

/**
 * Resolve an at-bat by comparing a random number against skill thresholds.
 * Translated from Hitters.java / Pitchers.java Swing_At_Pitch()
 *
 * The dominant player's thresholds are used:
 *   - If pitcher TOT >= hitter TOT → pitcher thresholds (pitcher advantage)
 *   - Otherwise → hitter thresholds (batter advantage)
 */
export function resolveAtBat(
  hitterThresholds: SkillThresholds,
  pitcherThresholds: SkillThresholds,
): { outcome: AtBatOutcome; roll: number } {
  const sum = pitcherThresholds.TOT / hitterThresholds.TOT;
  const thresholds = sum >= 1 ? pitcherThresholds : hitterThresholds;

  const roll = Math.random();

  let outcome: AtBatOutcome;

  if (roll <= thresholds.S) {
    outcome = AtBatOutcome.Single;
  } else if (roll <= thresholds.D) {
    outcome = AtBatOutcome.Double;
  } else if (roll <= thresholds.T) {
    outcome = AtBatOutcome.Triple;
  } else if (roll <= thresholds.HR) {
    outcome = AtBatOutcome.HomeRun;
  } else if (roll <= thresholds.BB) {
    outcome = AtBatOutcome.Walk;
  } else if (roll <= thresholds.K) {
    outcome = AtBatOutcome.Strikeout;
  } else {
    outcome = AtBatOutcome.GroundOut;
  }

  return { outcome, roll };
}
