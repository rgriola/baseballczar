/**
 * Phase 3 — Play Intelligence (PI) decision functions.
 *
 * The deterministic responsibility table (see ./responsibilities.ts)
 * supplies the *textbook* coverage for every play. These functions
 * roll PI to decide whether the fielder/runner actually executes the
 * textbook play, makes a conservative read, or makes a mistake.
 *
 * Design rules:
 *   - PI is the DECISION attribute. Defense skill is the EXECUTION
 *     attribute. PI tells you to try; defense tells you if it works.
 *   - The decision-maker is whoever has the ball in their hand. The
 *     receiver's PI does NOT factor in (kept simple per design notes).
 *   - All randomness routes through `Rng` for reproducibility.
 *   - We round-trip on `CoverageAssignments` so the visualizer and
 *     PBP read the same structure regardless of whether PI changed it.
 */
import type { Rng } from '../rng';
import type { Player } from '../types';
import type { CoverageAssignments, Base } from './responsibilities';

const DEFAULT_PI = 5;

/**
 * Resolve a player's Play Intelligence with a default for legacy
 * fixtures that don't set it. Centralizing here means any future
 * change (e.g. derive from defense + experience) is one edit.
 */
export function getPlayIntelligence(player: Player | undefined): number {
  return player?.skills.playIntelligence ?? DEFAULT_PI;
}

/**
 * Roll PI vs. a difficulty number. Returns true on a successful read.
 *
 * Effective PI = pi + gaussian(0, 1.5). Read succeeds if effective
 * >= difficulty. Calibrated so that:
 *   - PI 9 vs diff 7  → ~91% success (textbook play almost always)
 *   - PI 5 vs diff 7  → ~9%  success (low-PI fielder usually misreads)
 *   - PI 5 vs diff 5  → ~50% success (coin flip on a tough read)
 *   - PI 2 vs diff 7  → ~<1% success (low-PI fielder essentially never
 *                                     makes the right call)
 */
export function rollPI(pi: number, difficulty: number, rng: Rng): boolean {
  const effective = pi + rng.gaussian(0, 1.5);
  return effective >= difficulty;
}

/**
 * Decision: should the fielder execute the textbook throw, or
 * downgrade to a safer/conservative target?
 *
 * Downgrade ladder (riskier → safer):
 *   home   → third
 *   third  → second
 *   second → first        (no-runners single: just settle for the out)
 *   first  → first        (already the safest; no downgrade)
 *
 * High-PI fielders almost always pick the textbook target. Low-PI
 * fielders concede the lead runner and take the safer base. Result:
 * fewer "throw home with no chance, lets the batter take 2nd"
 * mistakes for high-PI defenses; more "should've gone home but
 * defense conceded" for low-PI defenses.
 *
 * Returns the (possibly modified) coverage. The cutoff is preserved
 * when the throw target stays in the OF lane (home/3B); on a
 * downgrade to 2B or 1B the cutoff is dropped (fielder throws
 * directly).
 */
export function decideThrowTarget(
  coverage: CoverageAssignments,
  fielder: Player | undefined,
  rng: Rng,
): CoverageAssignments {
  if (!coverage.throwTarget) return coverage;
  const pi = getPlayIntelligence(fielder);

  // Difficulty by target — throwing out a runner at home is the
  // hardest read (timing + arm + cutoff judgement). Calibrated against
  // gaussian(σ=1.5) so PI 9 makes the textbook play ~90%+ of the
  // time and PI 2 essentially never does.
  const difficulty: Record<Base, number> = {
    home: 7,
    third: 6,
    second: 5,
    first: 4,
  };
  const target = coverage.throwTarget;
  // Routine throw to 1B doesn't get rolled.
  if (target === 'first') return coverage;

  const success = rollPI(pi, difficulty[target], rng);
  if (success) return coverage;

  // Downgrade.
  const downgrade: Record<Base, Base> = {
    home: 'third',
    third: 'second',
    second: 'first',
    first: 'first',
  };
  const newTarget = downgrade[target];
  // Drop cutoff if we're no longer threading an OF relay.
  const dropCutoff = newTarget === 'second' || newTarget === 'first';
  return {
    ...coverage,
    throwTarget: newTarget,
    cutoff: dropCutoff ? null : coverage.cutoff,
  };
}
