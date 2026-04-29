/**
 * Phase A refactor — canonical base-advance resolver.
 *
 * Single source of truth for "given pre-play bases + an at-bat
 * result, where does each runner end up?". Replaces the parallel
 * `advanceRunners` switch in `game.ts` and the per-result switch in
 * `events/baseRunning.ts`. Both consumers walk the same `trips`
 * array — the engine to mutate state, the visualizer to emit
 * runner-advance / out / run-scored events.
 *
 * Pure: no mutation, no rolls (PI gates are passed in via opts).
 */
import type { AtBatResult, Player } from '../types';

export type Base = 'home' | 'first' | 'second' | 'third';

/**
 * One runner's resolved movement on this play. The visualizer
 * expands `from → to` into per-90-ft segments via its own
 * `pathBetween` helper. `outRecorded` flags trips that end in an
 * out (DP runner, FC runner, batter on a ground-out, batter on a
 * caught fly).
 */
export interface RunnerTrip {
  runner: Player;
  from: Base;
  to: Base;             // 'home' = scored (unless outRecorded)
  outRecorded?: boolean;
  isBatter?: boolean;
}

export interface AdvanceResult {
  /** Post-play [r1, r2, r3]. */
  newBases: (Player | null)[];
  /** Every runner's trip on this play, in roster order then batter. */
  trips: RunnerTrip[];
  /** Runners who actually scored (to === 'home' && !outRecorded). */
  scorers: Player[];
  /** Total runs scored on the play (= scorers.length). */
  runsScored: number;
  /** Outs recorded on the play (0, 1, or 2). */
  outsRecorded: number;
}

export interface AdvanceOpts {
  errorType?: 'fielding' | 'throw';
  /**
   * Phase 4 PI gate: if true, r1 stays at 2B on a single instead of
   * advancing to 3B. Computed by the caller via `decideRunnerAdvance`.
   */
  r1HoldsAtSecond?: boolean;
}

/**
 * Resolve the post-play base state and per-runner trips for any
 * AtBatResult. Returns immutable data; caller mutates the world.
 */
export function resolveBaseAdvance(
  bases: readonly (Player | null)[],
  batter: Player,
  result: AtBatResult,
  opts: AdvanceOpts = {},
): AdvanceResult {
  const [r1, r2, r3] = bases;
  const trips: RunnerTrip[] = [];
  let nb: (Player | null)[] = [r1 ?? null, r2 ?? null, r3 ?? null];
  let outsRecorded = 0;

  const trip = (
    runner: Player,
    from: Base,
    to: Base,
    flags: { outRecorded?: boolean; isBatter?: boolean } = {},
  ) => {
    trips.push({ runner, from, to, ...flags });
    if (flags.outRecorded) outsRecorded++;
  };

  switch (result) {
    case 'walk':
    case 'hbp':
    case 'reached-on-error': {
      // Force advance from the back; runners not forced hold their bag.
      const after: (Player | null)[] = [r1 ?? null, r2 ?? null, r3 ?? null];
      let push: Player | null = batter;
      let i = 0;
      const fromBaseOf = (idx: number): Base =>
        (['home', 'first', 'second'] as const)[idx];
      const toBaseOf = (idx: number): Base =>
        (['first', 'second', 'third'] as const)[idx];
      while (push && i < 3) {
        const occupant = after[i];
        // Push only if the bag is occupied (forced) — otherwise the
        // current `push` settles here and we stop the cascade.
        if (!occupant) {
          after[i] = push;
          trip(push, fromBaseOf(i), toBaseOf(i), { isBatter: push === batter });
          push = null;
          break;
        }
        after[i] = push;
        trip(push, fromBaseOf(i), toBaseOf(i), { isBatter: push === batter });
        push = occupant;
        i++;
      }
      // Forced past 3B → home.
      if (push) trip(push, 'third', 'home');

      // Throw-error: every existing baserunner takes one extra base
      // on top of the force. Preserve the post-force snapshot.
      if (result === 'reached-on-error' && opts.errorType === 'throw') {
        const a = after.slice();
        if (a[2] && a[2] !== batter) {
          trip(a[2]!, 'third', 'home');
          after[2] = null;
        }
        if (a[1] && a[1] !== batter) {
          trip(a[1]!, 'second', 'third');
          after[2] = a[1];
          after[1] = null;
        }
        if (a[0] && a[0] !== batter) {
          trip(a[0]!, 'first', 'second');
          after[1] = a[0];
          after[0] = batter;
        }
      }
      nb = after;
      break;
    }

    case 'single': {
      if (r3) trip(r3, 'third', 'home');
      if (r2) trip(r2, 'second', 'home');
      const r1Dest: Base = opts.r1HoldsAtSecond ? 'second' : 'third';
      if (r1) trip(r1, 'first', r1Dest);
      trip(batter, 'home', 'first', { isBatter: true });
      nb = [
        batter,
        r1 && r1Dest === 'second' ? r1 : null,
        r1 && r1Dest === 'third' ? r1 : null,
      ];
      break;
    }

    case 'double': {
      if (r3) trip(r3, 'third', 'home');
      if (r2) trip(r2, 'second', 'home');
      if (r1) trip(r1, 'first', 'third');
      trip(batter, 'home', 'second', { isBatter: true });
      nb = [null, batter, r1 ?? null];
      break;
    }

    case 'triple': {
      if (r3) trip(r3, 'third', 'home');
      if (r2) trip(r2, 'second', 'home');
      if (r1) trip(r1, 'first', 'home');
      trip(batter, 'home', 'third', { isBatter: true });
      nb = [null, null, batter];
      break;
    }

    case 'home-run': {
      if (r3) trip(r3, 'third', 'home');
      if (r2) trip(r2, 'second', 'home');
      if (r1) trip(r1, 'first', 'home');
      trip(batter, 'home', 'home', { isBatter: true });
      nb = [null, null, null];
      break;
    }

    case 'sac-fly': {
      // Batter caught in the OF (no advance — from === to means the
      // visualizer skips animation; out is still recorded).
      trip(batter, 'home', 'home', { isBatter: true, outRecorded: true });
      if (r3) trip(r3, 'third', 'home');
      // r2 advances to 3B (engine convention; matches legacy behavior).
      if (r2) trip(r2, 'second', 'third');
      nb = [r1 ?? null, null, r2 ?? null];
      break;
    }

    case 'double-play': {
      // Batter out at 1B, lead runner out at 2B. Runners on 2B/3B
      // were not forced and hold.
      if (r1) trip(r1, 'first', 'second', { outRecorded: true });
      trip(batter, 'home', 'first', { isBatter: true, outRecorded: true });
      nb = [null, r2 ?? null, r3 ?? null];
      break;
    }

    case 'fielders-choice': {
      // Lead runner out at 2B; batter safe at 1B; r2 forced to 3B.
      if (r1) trip(r1, 'first', 'second', { outRecorded: true });
      trip(batter, 'home', 'first', { isBatter: true });
      if (r2) trip(r2, 'second', 'third');
      nb = [batter, null, r2 ?? null];
      break;
    }

    case 'ground-out': {
      // Batter sprints toward 1B and is thrown out. Forced runners
      // advance one bag (defense conceded the lead runner for the
      // easy out). Non-forced runners hold.
      trip(batter, 'home', 'first', { isBatter: true, outRecorded: true });
      if (r1 && r2 && r3) {
        // Bases loaded: r3 forced home.
        trip(r3, 'third', 'home');
        trip(r2, 'second', 'third');
        trip(r1, 'first', 'second');
        nb = [null, r1, r2];
      } else if (r1 && r2) {
        trip(r2, 'second', 'third');
        trip(r1, 'first', 'second');
        nb = [null, r1, r2];
      } else if (r1) {
        trip(r1, 'first', 'second');
        nb = [null, r1, r3 ?? null];
      } else {
        // No r1: nobody forced, runners hold.
        nb = [null, r2 ?? null, r3 ?? null];
      }
      break;
    }

    case 'strikeout':
    case 'foul-out':
    case 'pop-out':
    case 'line-out':
    case 'fly-out': {
      // Batter out at the plate / on the catch — no physical advance.
      // (`from === to` signals the visualizer to skip animation.)
      trip(batter, 'home', 'home', { isBatter: true, outRecorded: true });
      nb = [r1 ?? null, r2 ?? null, r3 ?? null];
      break;
    }
  }

  const scorers = trips
    .filter(t => t.to === 'home' && !t.outRecorded)
    .map(t => t.runner);

  return {
    newBases: nb,
    trips,
    scorers,
    runsScored: scorers.length,
    outsRecorded,
  };
}
