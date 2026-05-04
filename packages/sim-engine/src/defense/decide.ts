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
 * Phase 4 — Game-state context that nudges PI difficulty up or down
 * for the current play. Lets a defense concede runs when up big and
 * "must cut" when the tying run is at the plate late.
 */
export interface GameContext {
  /** Defense's lead. Positive = defense ahead, negative = behind, 0 = tied. */
  defenseLeadDeficit: number;
  /** Inning number, 1+. 9+ flips into "must hold the lead" mode. */
  inning: number;
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
 * Game context (Phase 4): when the defense is up big the difficulty
 * for a throw home is *raised* (concede the run, keep the DP in
 * order). When the defense is tied or down 1 in the 9th+, the
 * difficulty is *lowered* (must cut the runner at home at all costs).
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
  gameContext?: GameContext,
  /** [r1, r2, r3] — truthy if occupied BEFORE the play. Needed so the
   *  downgrade ladder doesn't throw to a base that's already occupied
   *  (e.g. runner already on 3B → don't downgrade home→third). */
  bases?: readonly (unknown | null)[],
): CoverageAssignments {
  if (!coverage.throwTarget) return coverage;
  const pi = getPlayIntelligence(fielder);

  // Difficulty by target — throwing out a runner at home is the
  // hardest read (timing + arm + cutoff judgement). Calibrated against
  // gaussian(σ=1.5) so PI 9 makes the textbook play ~90%+ of the
  // time and PI 2 essentially never does.
  const baseDifficulty: Record<Base, number> = {
    home: 7,
    third: 6,
    second: 5,
    first: 4,
  };
  const target = coverage.throwTarget;
  // Routine throw to 1B doesn't get rolled.
  if (target === 'first') return coverage;

  // Game-context modifier — applied only to the throw-home decision
  // (the other targets aren't run-conceding plays). Sign convention:
  // positive bumps the difficulty (less likely to throw home),
  // negative lowers it (more likely to throw home).
  let modifier = 0;
  if (target === 'home' && gameContext) {
    const { defenseLeadDeficit, inning } = gameContext;
    if (defenseLeadDeficit >= 4) {
      // Up by ≥4: concede the run, keep the DP in order. Raise the
      // bar so even a high-PI fielder usually hits the cutoff.
      modifier += 2;
    } else if (defenseLeadDeficit >= 1 && inning >= 7) {
      // Late and protecting a slim lead: still slightly conservative.
      modifier += 1;
    }
    if (inning >= 9 && defenseLeadDeficit <= 0) {
      // Tied or behind in the 9th+: must cut the go-ahead/tying run.
      // Lower the bar so PI 5 fielders attempt the play far more often.
      modifier -= 2;
    }
  }

  const difficulty = baseDifficulty[target] + modifier;
  const success = rollPI(pi, difficulty, rng);
  if (success) return coverage;

  // ─── Runner-aware downgrade ────────────────────────────────────
  // Walk down from one step below the original target, skipping any
  // base that's already occupied (no play to make there).
  //
  // Full ladder: home → third → second → first.
  // We start from the entry BELOW `target` and walk down.
  const r1 = !!bases?.[0];
  const r2 = !!bases?.[1];
  const r3 = !!bases?.[2];

  const fullLadder: Base[] = ['home', 'third', 'second', 'first'];
  const startIdx = fullLadder.indexOf(target) + 1; // one step below
  let newTarget: Base = 'second'; // fallback: throw to 2B (batter)
  for (let i = startIdx; i < fullLadder.length; i++) {
    const candidate = fullLadder[i];
    // Skip if this base already had a runner — no play to make there
    // (the runner is advancing OUT of that base, not into it).
    if (candidate === 'third' && r3) continue;
    if (candidate === 'second' && r2) continue;
    // First base is always a valid target (batter is always heading there).
    newTarget = candidate;
    break;
  }

  // Drop cutoff if we're no longer threading an OF relay lane.
  // Cutoffs are only used for throws to home or 3B (long-distance
  // relays). Throws to 2B/1B go direct.
  const dropCutoff = newTarget === 'second' || newTarget === 'first';
  return {
    ...coverage,
    throwTarget: newTarget,
    cutoff: dropCutoff ? null : coverage.cutoff,
  };
}

/**
 * Phase 4 — Runner advance PI gate.
 *
 * Decides whether a baserunner takes the *aggressive* extra base on
 * a play (e.g. r1 → 3rd on a single) or stops at the conservative
 * base. The runner is the decision-maker; speed is added as a small
 * execution bonus (faster runners can afford to be more aggressive).
 *
 * Effective PI = pi + (speed - 5) * 0.4 + gaussian(0, 1.5).
 *
 * Difficulty:
 *   - 'r1-to-3rd-single':  6 (judgement call; sometimes you hold)
 *   - 'r2-to-home-single': 5 (usually score; only hold on a sharp single)
 *
 * Returns true if the runner takes the extra base.
 */
export type RunnerDecision = 'r1-to-3rd-single' | 'r2-to-home-single';

const RUNNER_DIFFICULTY: Record<RunnerDecision, number> = {
  'r1-to-3rd-single': 6,
  'r2-to-home-single': 5,
};

export function decideRunnerAdvance(
  decision: RunnerDecision,
  runner: Player | undefined,
  rng: Rng,
): boolean {
  const pi = getPlayIntelligence(runner);
  const speed = runner?.skills.speed ?? 5;
  const difficulty = RUNNER_DIFFICULTY[decision];
  const effective = pi + (speed - 5) * 0.4 + rng.gaussian(0, 1.5);
  return effective >= difficulty;
}
