/**
 * Base-running event emitter. Walks the runner state forward for an
 * at-bat, emitting `runner-advance`, `out`, and `run-scored` events.
 *
 * Phase A refactor: the per-result switch that used to live here was
 * a near-duplicate of `game.ts/advanceRunners`. Both paths now consume
 * the canonical `resolveBaseAdvance` from `rules/advance.ts`. This
 * file's only job is to translate the resolved `trips` into timed
 * visual events.
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
import type { AtBatRecord, Player } from '../types';
import type { Position } from '../config';
import { runnerTimeSec, type BaseName } from '../physics/speed';
import { resolveBaseAdvance, type Base, type RunnerTrip } from '../rules/advance';
import type { SimEventInit } from './types';

const ORDER: Base[] = ['home', 'first', 'second', 'third'];

/**
 * Build the path of bases a runner traverses going from `from` to `to`.
 * Always touches each intermediate bag in baseball order. `to` may be
 * 'home' meaning a full lap around (e.g. r1 scoring on a triple goes
 * first → second → third → home).
 */
function pathBetween(from: Base, to: Base): Base[] {
  const idx = (b: Base) => ORDER.indexOf(b);
  const path: Base[] = [from];
  let cur = idx(from);
  do {
    cur = (cur + 1) % 4;
    path.push(ORDER[cur]);
  } while (ORDER[cur] !== to);
  return path;
}

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
  const [r1, r2] = bases;
  const batter = ab.batter;
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

  const advance = (
    runner: Player,
    from: Base,
    to: Base,
    isBatter: boolean,
    scoresAtHome: boolean,
  ) => {
    const path = pathBetween(from, to);
    let cursor = tOf(runner.id);
    for (let i = 0; i < path.length - 1; i++) {
      const segFrom = path[i] as BaseName;
      const segTo = path[i + 1] as BaseName;
      const fromContact = isBatter && segFrom === 'home';
      let segSec = runnerTimeSec(
        segFrom,
        segTo,
        runner.skills.speed,
        fromContact ? { fromContact: true, hand: runner.hand } : {},
      );
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
    if (scoresAtHome) score(runner, cursor);
    if (cursor > latestT) latestT = cursor;
  };

  let outsRecorded = 0;
  const recordOut = (
    runner: Player | undefined,
    atPosition?: Position,
    atTOverride?: number,
  ) => {
    outsRecorded++;
    const atT = atTOverride ?? (runner ? tOf(runner.id) : startT);
    pushAt({
      type: 'out',
      outNum: outsBefore + outsRecorded,
      reason: ab.result,
      atPosition,
      runnerId: runner?.id,
    }, atT + 0.05);
    if (atT + 0.05 > latestT) latestT = atT + 0.05;
  };

  // ─── Resolve runner trips via the canonical engine path ──────────
  const r1HoldsAtSecond = ab.runnerAdvances?.r1OnSingle === 'second';
  const adv = resolveBaseAdvance(bases, batter, ab.result, {
    errorType: ab.errorType,
    r1HoldsAtSecond,
    outsBefore,
  });

  /** Time the out at throw / catch arrival when applicable. */
  const outTimeFor = (trip: RunnerTrip): number | undefined => {
    if (!trip.outRecorded) return undefined;
    if (trip.isBatter) {
      switch (ab.result) {
        case 'double-play':
          return throwArrivesAt != null ? throwArrivesAt + 0.6 : undefined;
        case 'ground-out':
          return throwArrivesAt;
        case 'sac-fly':
        case 'fly-out':
        case 'line-out':
        case 'pop-out':
          return catchArrivesAt;
        default:
          return undefined;  // strikeout, foul-out: at startT
      }
    }
    // Forced runner out at a base (DP r1, FC r1).
    return throwArrivesAt;
  };

  /** Where the out is credited (B1 for batter on grounder, B2 for force). */
  const outPositionFor = (trip: RunnerTrip): Position | undefined => {
    if (!trip.outRecorded) return undefined;
    if (trip.isBatter) {
      if (ab.result === 'double-play' || ab.result === 'ground-out') return 'B1';
      return ab.fieldedBy;
    }
    return 'B2';
  };

  for (const trip of adv.trips) {
    const isHRLap = ab.result === 'home-run' && trip.isBatter;
    const moves = trip.from !== trip.to || isHRLap;
    const scoresAtHome = trip.to === 'home' && !trip.outRecorded && moves === true;
    if (moves) {
      advance(trip.runner, trip.from, trip.to, !!trip.isBatter, scoresAtHome);
    }
    if (trip.outRecorded) {
      recordOut(trip.runner, outPositionFor(trip), outTimeFor(trip));
    }
  }

  // ─── Visual flair: 2-out hustle on caught flies ──────────────────
  // Engine-truth: runners hold. Visual: with 2 outs the runners go on
  // contact (no risk of being doubled off). These are NOT engine
  // advances — they're caught in motion when the third out fires.
  if (
    outsBefore === 2 &&
    (ab.result === 'fly-out' || ab.result === 'line-out' || ab.result === 'pop-out')
  ) {
    if (r2) advance(r2, 'second', 'third', false, false);
    if (r1) advance(r1, 'first', 'second', false, false);
  }

  return {
    newBases: adv.newBases,
    outsAfter: outsBefore + adv.outsRecorded,
    latestT,
  };
}
