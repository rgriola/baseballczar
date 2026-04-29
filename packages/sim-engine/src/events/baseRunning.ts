/**
 * Base-running event emitter. Walks the runner state forward for an
 * at-bat, emitting `runner-advance`, `out`, and `run-scored` events.
 *
 * Mirrors `game.ts/advanceRunners` but is *event-emitting* rather than
 * result-only. See the docblock on `emitBaseRunningEvents` for the
 * timing model.
 */
import type { AtBatRecord, Player } from '../types';
import type { Position } from '../config';
import { runnerTimeSec, type BaseName } from '../physics/speed';
import type { SimEventInit } from './types';

type Base = 'home' | 'first' | 'second' | 'third';
const ORDER: Base[] = ['home', 'first', 'second', 'third'];

/**
 * Build the path of bases a runner traverses going from `from` to `to`.
 * Always touches each intermediate bag in baseball order. `to` may be
 * 'home' meaning a full lap around (e.g. r1 scoring on a triple goes
 * first → second → third → home).
 */
function pathBetween(from: Base, to: Base | 'home'): Base[] {
  const idx = (b: Base) => ORDER.indexOf(b);
  const path: Base[] = [from];
  let cur = idx(from);
  // 'home' as destination from a non-home base means continue forward
  // (third → home), wrapping past 'third'.
  do {
    cur = (cur + 1) % 4;
    path.push(ORDER[cur]);
  } while (ORDER[cur] !== to);
  return path;
}

/**
 * Walk the runner state forward for an at-bat, emitting `runner-advance`,
 * `out`, and `run-scored` events. Mutates `bases` in place. Returns the
 * post-AB outs count and the latest absolute timestamp at which any
 * runner finishes their advance (so the caller can keep the global clock
 * in sync before emitting `at-bat-end`).
 *
 * Timing model:
 *   • Runners react `runnerReactionSec` after contact, then move at
 *     `perBaseSec` per 90-ft segment.
 *   • Each runner has an independent time cursor, so multiple runners
 *     advance in PARALLEL (not serialized after the fielder's play).
 *   • Multi-base advances (double, triple, etc.) emit one event per
 *     90-ft segment so the renderer naturally routes the runner through
 *     each intervening base instead of cutting straight across the diamond.
 */
export function emitBaseRunningEvents(
  ab: AtBatRecord,
  bases: (Player | null)[],
  outsBefore: number,
  scoreHome: { v: number },
  scoreAway: { v: number },
  battingTeamId: number,
  battingTeamIsHome: boolean,
  startT: number,
  pushAt: (e: SimEventInit, absT: number) => void,
  throwArrivesAt?: number,
  catchArrivesAt?: number,
): { newBases: (Player | null)[]; outsAfter: number; latestT: number } {
  const [r1, r2, r3] = bases;
  const batter = ab.batter;
  let nb: (Player | null)[] = [r1, r2, r3];
  let outsAfter = outsBefore;
  let latestT = startT;

  // Per-runner time cursor (defaults to startT until a runner moves).
  const runnerT = new Map<number, number>();
  const tOf = (id: number) => runnerT.get(id) ?? startT;

  const score = (runner: Player, atT: number) => {
    if (battingTeamIsHome) scoreHome.v++;
    else scoreAway.v++;
    pushAt({
      type: 'run-scored',
      runnerId: runner.id,
      battingTeamId,
      scoreHome: scoreHome.v,
      scoreAway: scoreAway.v,
    }, atT + 0.05);
  };

  /**
   * Advance a runner from `from` through to `to`, emitting one
   * `runner-advance` event per 90-ft segment so the renderer touches
   * each intermediate base.
   */
  const advance = (
    runner: Player,
    from: Base,
    to: 'first' | 'second' | 'third' | 'home',
    isBatter = false,
  ) => {
    const path = pathBetween(from, to);
    let cursor = tOf(runner.id);
    for (let i = 0; i < path.length - 1; i++) {
      const segFrom = path[i] as BaseName;
      const segTo = path[i + 1] as BaseName;
      // Only the very first segment off the bat counts as fromContact;
      // subsequent base-to-base legs use the secondary lead model.
      const fromContact = isBatter && segFrom === 'home';
      let segSec = runnerTimeSec(
        segFrom,
        segTo,
        runner.skills.speed,
        fromContact ? { fromContact: true, hand: runner.hand } : {},
      );
      // Home-run trot: every runner (batter + anyone already on base)
      // jogs the bases as a celebration. Slow each leg by ~60% so the
      // visual reads as a trot rather than a sprint.
      if (ab.result === 'home-run') segSec *= 1.6;
      pushAt({
        type: 'runner-advance',
        runnerId: runner.id,
        fromBase: path[i],
        toBase: path[i + 1] as 'first' | 'second' | 'third' | 'home',
        travelSec: segSec,
      }, cursor);
      cursor += segSec;
    }
    runnerT.set(runner.id, cursor);
    if (to === 'home') score(runner, cursor);
    if (cursor > latestT) latestT = cursor;
  };

  const recordOut = (
    runner: Player | undefined,
    atPosition?: Position,
    atTOverride?: number,
  ) => {
    outsAfter++;
    // Time the out at the runner's current cursor (when they reached the
    // bag where they were forced out), or startT for non-running outs
    // (strikeout, foul-out). `atTOverride` lets the caller align the out
    // with throw arrival for plays decided in the air.
    const atT = atTOverride ?? (runner ? tOf(runner.id) : startT);
    pushAt({
      type: 'out',
      outNum: outsAfter,
      reason: ab.result,
      atPosition,
      runnerId: runner?.id,
    }, atT + 0.05);
    if (atT + 0.05 > latestT) latestT = atT + 0.05;
  };

  switch (ab.result) {
    case 'walk':
    case 'hbp':
    case 'reached-on-error': {
      // Force advances
      let push1: Player | null = batter;
      let i = 0;
      while (push1 && i < 3) {
        const occupant = bases[i];
        nb[i] = push1;
        const fromBase = (['home', 'first', 'second'] as const)[i];
        const toBase = (['first', 'second', 'third'] as const)[i];
        advance(push1, fromBase, toBase);
        push1 = occupant;
        if (!occupant) { push1 = null; break; }
        i++;
      }
      if (push1) advance(push1, 'third', 'home');

      // Phase 5.13: throw error — every existing baserunner advances one
      // extra base on top of the force (matches game.ts advanceRunners).
      if (ab.result === 'reached-on-error' && ab.errorType === 'throw') {
        const after = [nb[0], nb[1], nb[2]];
        if (after[2] && after[2] !== batter) advance(after[2], 'third', 'home');
        if (after[1] && after[1] !== batter) advance(after[1], 'second', 'third');
        if (after[0] && after[0] !== batter) advance(after[0], 'first', 'second');
      }
      break;
    }
    case 'single': {
      if (r3) advance(r3, 'third', 'home');
      if (r2) advance(r2, 'second', 'home');
      // Honor the engine's PI-gated decision (Phase 4). Default 'third'.
      const r1Dest = ab.runnerAdvances?.r1OnSingle ?? 'third';
      if (r1) advance(r1, 'first', r1Dest);
      advance(batter, 'home', 'first', true);
      nb = [batter, r1Dest === 'second' ? r1 ?? null : null, r1Dest === 'third' ? r1 ?? null : null];
      break;
    }
    case 'double': {
      if (r3) advance(r3, 'third', 'home');
      if (r2) advance(r2, 'second', 'home');
      if (r1) advance(r1, 'first', 'third');
      advance(batter, 'home', 'second', true);
      nb = [null, batter, r1 ?? null];
      break;
    }
    case 'triple': {
      if (r3) advance(r3, 'third', 'home');
      if (r2) advance(r2, 'second', 'home');
      if (r1) advance(r1, 'first', 'home');
      advance(batter, 'home', 'third', true);
      nb = [null, null, batter];
      break;
    }
    case 'home-run': {
      if (r3) advance(r3, 'third', 'home');
      if (r2) advance(r2, 'second', 'home');
      if (r1) advance(r1, 'first', 'home');
      advance(batter, 'home', 'home', true);
      nb = [null, null, null];
      break;
    }
    case 'strikeout':
    case 'foul-out': {
      recordOut(batter);
      break;
    }
    case 'pop-out':
    case 'line-out':
    case 'fly-out': {
      // With 2 outs, runners go on contact (no risk of being doubled
      // off — the inning ends on the catch either way). Emit visual
      // advances toward the next bag so they're caught in motion when
      // the third out is recorded. Skip r3 → home since `advance()`
      // would credit a phantom run; the inning ends on the catch.
      if (outsBefore === 2) {
        if (r2) advance(r2, 'second', 'third');
        if (r1) advance(r1, 'first', 'second');
      }
      // Time the out at the actual catch (contact + hangTime). Without
      // this the out fires ~0.25s after contact and at-bat-end snaps
      // the ball back to the mound mid-flight, so the viewer sees the
      // ball vanish before the fielder reaches it.
      recordOut(batter, ab.fieldedBy, catchArrivesAt);
      break;
    }
    case 'ground-out': {
      // Batter sprints toward first while the throw is in flight; out is
      // recorded when the throw arrives at the bag (see throwArrivesAt).
      advance(batter, 'home', 'first', true);
      // Forced runners advance one base on a plain ground-out (defense
      // took the easy out at 1B). With 2 outs this is academic—inning
      // ends on the throw—but we still emit the visual.
      if (r1) {
        advance(r1, 'first', 'second');
        if (r2) {
          advance(r2, 'second', 'third');
          if (r3) advance(r3, 'third', 'home');
        }
      } else if (outsBefore === 2) {
        // No forced runners; only emit the heads-up advances when the
        // inning is about to end on the throw (matches old behavior).
        if (r2) advance(r2, 'second', 'third');
      }
      recordOut(batter, ab.fieldedBy, throwArrivesAt);
      break;
    }
    case 'double-play': {
      // Batter out at 1B, lead runner (1B) out at 2B.
      // Runners on 2B/3B were not forced and hold.
      if (r1) {
        // Runner moves toward 2B; called out when relay arrives.
        advance(r1, 'first', 'second');
        recordOut(r1, 'B2', throwArrivesAt);
      }
      // Batter sprinting toward 1B; out when relay throw arrives. Add an
      // extra ~0.6s for the pivot/relay throw beyond the initial fielding.
      advance(batter, 'home', 'first', true);
      recordOut(batter, 'B1', throwArrivesAt != null ? throwArrivesAt + 0.6 : undefined);
      nb = [null, r2 ?? null, r3 ?? null];
      break;
    }
    case 'fielders-choice': {
      // Lead runner out at 2B; batter to 1B safely. Other runners hold.
      if (r1) {
        advance(r1, 'first', 'second');
        recordOut(r1, 'B2', throwArrivesAt);
      }
      advance(batter, 'home', 'first', true);
      nb = [batter, r2 ?? null, r3 ?? null];
      break;
    }
    case 'sac-fly': {
      recordOut(batter, ab.fieldedBy, catchArrivesAt);
      if (r3) advance(r3, 'third', 'home');
      nb = [r1, null, r2 ?? null];
      break;
    }
  }

  return { newBases: nb, outsAfter, latestT };
}
