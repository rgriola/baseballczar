import { BASE_COORDS_FT } from '@baseballczar/sim-engine';
import type {
  AtBatRecord,
  AtBatResult,
  BattedBall,
  Player,
  Position,
  ResolvePlayFn,
  ResolvePlayResult,
} from '@baseballczar/sim-engine';
import type { GameSituation } from './aiManager';
import type { TickSimOptions } from './tickEngine';
import { simulateAtBatTick } from './tickEngine';

export interface HeadlessRunnerState {
  runnerId: number;
  base: 'first' | 'second' | 'third';
}

export interface HeadlessAtBatStatDeltas {
  outsRecorded: number;
  runsScored: number;
  rbis: number;
  hits: number;
  totalBases: number;
  batterOut: boolean;
  batterScored: boolean;
}

export interface HeadlessAtBatResolution {
  outcome: AtBatResult;
  statDeltas: HeadlessAtBatStatDeltas;
  runnersAfter: HeadlessRunnerState[];
  scoredRunnerIds: number[];
  outRunnerIds: number[];
  resolver: 'tick-events' | 'contact-heuristic' | 'seed-non-batted';
  usedPreRollFallback: boolean;
}

export interface HeadlessTickResolveOptions extends Omit<TickSimOptions, 'captureEvery'> {
  teamColor?: number;
  situation?: GameSituation;
}

const HIT_BASES: Record<string, number> = {
  single: 1,
  double: 2,
  triple: 3,
  'home-run': 4,
  'base-hit': 1,  // fallback; resolved to actual hit type by extractTickOutcome
};
const HOME_PLACEHOLDER_RADIUS_FT = 20;

type RunnerStateInput = { player: Player; base: 'first' | 'second' | 'third' }[];

function distanceFromHome(x: number, y: number): number {
  return Math.hypot(x - BASE_COORDS_FT.home.x, y - BASE_COORDS_FT.home.y);
}

function inferBaseFromPoint(point: { x: number; y: number }): 'home' | 'first' | 'second' | 'third' {
  const candidates: Array<'home' | 'first' | 'second' | 'third'> = ['home', 'first', 'second', 'third'];

  let best: 'home' | 'first' | 'second' | 'third' = 'home';
  let bestDist = Infinity;

  for (const base of candidates) {
    const anchor = BASE_COORDS_FT[base];
    const dist = Math.hypot(point.x - anchor.x, point.y - anchor.y);
    if (dist < bestDist) {
      best = base;
      bestDist = dist;
    }
  }

  return best;
}

function inferCaughtFlyOutcome(battedBall: BattedBall): AtBatResult {
  if (battedBall.isFoul || Math.abs(battedBall.sprayAngleDeg) > 45) {
    return 'foul-out';
  }

  if (battedBall.launchAngleDeg >= 65) return 'pop-out';
  if (battedBall.launchAngleDeg >= 24) return 'fly-out';
  return 'line-out';
}

function inferHeuristicHitOutcome(battedBall: BattedBall): AtBatResult {
  if (battedBall.isHomeRun) return 'home-run';
  if (battedBall.distanceFt >= 265) return 'triple';
  if (battedBall.distanceFt >= 180) return 'double';
  return 'single';
}

function sortedRunnersAfter(
  runners: HeadlessRunnerState[],
): HeadlessRunnerState[] {
  const baseOrder: Record<'first' | 'second' | 'third', number> = {
    first: 1,
    second: 2,
    third: 3,
  };

  return [...runners].sort((a, b) => baseOrder[a.base] - baseOrder[b.base]);
}

function advanceRunnersForHeuristicHit(
  outcome: AtBatResult,
  batterId: number,
  runners: RunnerStateInput,
): {
  runnersAfter: HeadlessRunnerState[];
  scoredRunnerIds: number[];
} {
  const runnersAfter: HeadlessRunnerState[] = [];
  const scoredRunnerIds: number[] = [];

  if (outcome === 'single') {
    for (const runner of runners) {
      if (runner.base === 'third') {
        scoredRunnerIds.push(runner.player.id);
      } else if (runner.base === 'second') {
        runnersAfter.push({ runnerId: runner.player.id, base: 'third' });
      } else {
        runnersAfter.push({ runnerId: runner.player.id, base: 'second' });
      }
    }
    runnersAfter.push({ runnerId: batterId, base: 'first' });
    return {
      runnersAfter: sortedRunnersAfter(runnersAfter),
      scoredRunnerIds,
    };
  }

  if (outcome === 'double') {
    for (const runner of runners) {
      if (runner.base === 'first') {
        runnersAfter.push({ runnerId: runner.player.id, base: 'third' });
      } else {
        scoredRunnerIds.push(runner.player.id);
      }
    }
    runnersAfter.push({ runnerId: batterId, base: 'second' });
    return {
      runnersAfter: sortedRunnersAfter(runnersAfter),
      scoredRunnerIds,
    };
  }

  if (outcome === 'triple') {
    for (const runner of runners) {
      scoredRunnerIds.push(runner.player.id);
    }
    runnersAfter.push({ runnerId: batterId, base: 'third' });
    return {
      runnersAfter,
      scoredRunnerIds,
    };
  }

  for (const runner of runners) {
    scoredRunnerIds.push(runner.player.id);
  }
  scoredRunnerIds.push(batterId);
  return {
    runnersAfter: [],
    scoredRunnerIds,
  };
}

function isBaseLabel(base: string): base is 'first' | 'second' | 'third' {
  return base === 'first' || base === 'second' || base === 'third';
}

function isOutResult(result: AtBatResult): boolean {
  return (
    result === 'ground-out' ||
    result === 'fly-out' ||
    result === 'line-out' ||
    result === 'pop-out' ||
    result === 'foul-out' ||
    result === 'strikeout' ||
    result === 'double-play' ||
    result === 'fielders-choice' ||
    result === 'sac-fly'
  );
}

function seedOutsRecorded(result: AtBatResult): number {
  if (result === 'double-play') return 2;
  return isOutResult(result) ? 1 : 0;
}

function inferHitOutcomeFromBase(base: 'first' | 'second' | 'third' | 'home'): AtBatResult {
  if (base === 'home') return 'home-run';
  if (base === 'third') return 'triple';
  if (base === 'second') return 'double';
  return 'single';
}

function deriveSeedNonBattedResolution(
  ab: AtBatRecord,
  runners: RunnerStateInput,
): HeadlessAtBatResolution {
  const scoredRunnerIds: number[] = [];
  if (ab.runsScored > 0) {
    const scorerCount = Math.min(ab.runsScored, runners.length + 1);
    for (let i = 0; i < scorerCount; i++) {
      if (i < runners.length) {
        scoredRunnerIds.push(runners[i].player.id);
      } else {
        scoredRunnerIds.push(ab.batter.id);
      }
    }
  }

  const hits = HIT_BASES[ab.result] != null ? 1 : 0;
  const totalBases = HIT_BASES[ab.result] ?? 0;
  const batterOut = seedOutsRecorded(ab.result) > 0;
  const batterScored = ab.result === 'home-run';

  return {
    outcome: ab.result,
    statDeltas: {
      outsRecorded: seedOutsRecorded(ab.result),
      runsScored: ab.runsScored,
      rbis: ab.rbis,
      hits,
      totalBases,
      batterOut,
      batterScored,
    },
    runnersAfter: [],
    scoredRunnerIds,
    outRunnerIds: batterOut ? [ab.batter.id] : [],
    resolver: 'seed-non-batted',
    usedPreRollFallback: true,
  };
}

function deriveContactHeuristicResolution(
  ab: AtBatRecord,
  runners: RunnerStateInput,
): HeadlessAtBatResolution {
  const battedBall = ab.battedBall;
  if (!battedBall) {
    return deriveSeedNonBattedResolution(ab, runners);
  }

  const outcome = inferHeuristicHitOutcome(battedBall);

  if (outcome === 'home-run') {
    const scoredRunnerIds = runners.map((runner) => runner.player.id);
    scoredRunnerIds.push(ab.batter.id);

    return {
      outcome,
      statDeltas: {
        outsRecorded: 0,
        runsScored: scoredRunnerIds.length,
        rbis: scoredRunnerIds.length,
        hits: 1,
        totalBases: 4,
        batterOut: false,
        batterScored: true,
      },
      runnersAfter: [],
      scoredRunnerIds,
      outRunnerIds: [],
      resolver: 'contact-heuristic',
      usedPreRollFallback: false,
    };
  }

  if (battedBall.isFoul) {
    return {
      outcome: 'foul-out',
      statDeltas: {
        outsRecorded: 1,
        runsScored: 0,
        rbis: 0,
        hits: 0,
        totalBases: 0,
        batterOut: true,
        batterScored: false,
      },
      runnersAfter: runners.map((runner) => ({
        runnerId: runner.player.id,
        base: runner.base,
      })),
      scoredRunnerIds: [],
      outRunnerIds: [ab.batter.id],
      resolver: 'contact-heuristic',
      usedPreRollFallback: false,
    };
  }

  const advanced = advanceRunnersForHeuristicHit(outcome, ab.batter.id, runners);
  const runsScored = advanced.scoredRunnerIds.length;
  const totalBases = HIT_BASES[outcome] ?? 0;

  return {
    outcome,
    statDeltas: {
      outsRecorded: 0,
      runsScored,
      rbis: runsScored,
      hits: 1,
      totalBases,
      batterOut: false,
      batterScored: false,
    },
    runnersAfter: advanced.runnersAfter,
    scoredRunnerIds: advanced.scoredRunnerIds,
    outRunnerIds: [],
    resolver: 'contact-heuristic',
    usedPreRollFallback: false,
  };
}

/**
 * Extract the authoritative at-bat outcome from pre-computed WorldSnapshots.
 *
 * This is the SINGLE SOURCE OF TRUTH for what happened on a batted ball.
 * Both the orchestrator (visual playback) and headless resolution use this.
 *
 * @param snapshots - WorldSnapshots from simulateAtBatTick()
 * @param batterId  - The batter's player ID
 * @param battedBall - The BattedBall physics data
 * @param runners   - Runners on base before the play
 */
export function extractTickOutcome(
  snapshots: import('./entities').WorldSnapshot[],
  batterId: number,
  battedBall: BattedBall,
  runners: RunnerStateInput = [],
  /** Outs at the start of the play. Used for force-out 3rd-out run nullification. */
  startingOuts: number = 0,
): HeadlessAtBatResolution {
  if (snapshots.length === 0) {
    return deriveContactHeuristicResolution(
      { battedBall, batter: { id: batterId } } as AtBatRecord,
      runners,
    );
  }

  const scoredRunnerIds = new Set<number>();
  const outRunnerIds = new Set<number>();
  const safeBasesByRunner = new Map<number, 'first' | 'second' | 'third'>();

  let wallCleared = false;
  let caughtFly = false;

  for (const snapshot of snapshots) {
    for (const event of snapshot.events) {
      if (event.type === 'wall-cleared') {
        wallCleared = true;
      } else if (event.type === 'ball-caught') {
        caughtFly = true;
      } else if (event.type === 'runner-out') {
        outRunnerIds.add(event.runnerId);
      } else if (event.type === 'runner-scored') {
        scoredRunnerIds.add(event.runnerId);
      } else if (event.type === 'runner-safe') {
        if (event.base === 'home') {
          scoredRunnerIds.add(event.runnerId);
        } else if (isBaseLabel(event.base)) {
          safeBasesByRunner.set(event.runnerId, event.base);
        }
      }
    }
  }

  if (caughtFly) {
    outRunnerIds.add(batterId);
  }

  if (wallCleared) {
    scoredRunnerIds.add(batterId);
    for (const runner of runners) {
      scoredRunnerIds.add(runner.player.id);
    }

    return {
      outcome: 'home-run',
      statDeltas: {
        outsRecorded: 0,
        runsScored: scoredRunnerIds.size,
        rbis: scoredRunnerIds.size,
        hits: 1,
        totalBases: 4,
        batterOut: false,
        batterScored: true,
      },
      runnersAfter: [],
      scoredRunnerIds: Array.from(scoredRunnerIds),
      outRunnerIds: Array.from(outRunnerIds),
      resolver: 'tick-events',
      usedPreRollFallback: false,
    };
  }

  const lastSnapshot = snapshots[snapshots.length - 1];
  const runnersAfterById = new Map<number, 'first' | 'second' | 'third'>();

  for (const runner of lastSnapshot.runners) {
    if (runner.state.type !== 'on-base') continue;

    if (
      runner.id === batterId
      && runner.state.base === 'first'
      && distanceFromHome(runner.pos.x, runner.pos.y) < HOME_PLACEHOLDER_RADIUS_FT
      && !safeBasesByRunner.has(batterId)
      && !scoredRunnerIds.has(batterId)
      && !outRunnerIds.has(batterId)
    ) {
      continue;
    }

    runnersAfterById.set(runner.id, runner.state.base);
  }

  for (const [runnerId, base] of safeBasesByRunner) {
    if (!scoredRunnerIds.has(runnerId) && !outRunnerIds.has(runnerId)) {
      runnersAfterById.set(runnerId, base);
    }
  }

  let batterOut = outRunnerIds.has(batterId);
  let batterScored = scoredRunnerIds.has(batterId);
  let batterBase: 'first' | 'second' | 'third' | 'home' | undefined;

  if (batterScored) {
    batterBase = 'home';
  } else if (!batterOut && safeBasesByRunner.has(batterId)) {
    batterBase = safeBasesByRunner.get(batterId);
  }

  const batterRunner = lastSnapshot.runners.find((runner) => runner.id === batterId);
  if (!batterOut && !batterScored && !batterBase && batterRunner) {
    if (batterRunner.state.type === 'out') {
      batterOut = true;
    } else if (batterRunner.state.type === 'scored') {
      batterScored = true;
      batterBase = 'home';
    } else if (batterRunner.state.type === 'on-base') {
      const isPlaceholderAtHome =
        batterRunner.state.base === 'first'
        && distanceFromHome(batterRunner.pos.x, batterRunner.pos.y) < HOME_PLACEHOLDER_RADIUS_FT;
      if (!isPlaceholderAtHome) {
        batterBase = batterRunner.state.base;
      }
    } else if (batterRunner.state.type === 'running') {
      const targetBase = inferBaseFromPoint(batterRunner.state.to);
      const totalDist = Math.hypot(
        batterRunner.state.to.x - batterRunner.state.from.x,
        batterRunner.state.to.y - batterRunner.state.from.y,
      );
      const coveredDist = Math.hypot(
        batterRunner.pos.x - batterRunner.state.from.x,
        batterRunner.pos.y - batterRunner.state.from.y,
      );
      const progress = totalDist > 0.001 ? coveredDist / totalDist : 0;

      if (targetBase === 'home' && progress >= 0.6) {
        batterScored = true;
        batterBase = 'home';
      } else if (targetBase !== 'home' && progress >= 0.65) {
        batterBase = targetBase;
      }
    }
  }

  if (!batterOut && !batterScored && !batterBase) {
    if (caughtFly) {
      batterOut = true;
    } else if (lastSnapshot.ball.state.type === 'held') {
      batterOut = true;
    } else {
      batterBase = 'first';
    }
  }

  if (batterOut) {
    outRunnerIds.add(batterId);
  }

  if (batterScored) {
    scoredRunnerIds.add(batterId);
    batterBase = 'home';
  }

  if (batterBase && batterBase !== 'home' && !batterOut) {
    runnersAfterById.set(batterId, batterBase);
  }

  let outcome: AtBatResult;
  if (batterScored) {
    outcome = 'home-run';
  } else if (batterOut) {
    const outsRecordedNow = Math.min(3, outRunnerIds.size);
    if (outsRecordedNow >= 2) {
      outcome = 'double-play';
    } else if (caughtFly) {
      outcome = scoredRunnerIds.size > 0 ? 'sac-fly' : inferCaughtFlyOutcome(battedBall);
    } else {
      outcome = 'ground-out';
    }
  } else if (outRunnerIds.size > 0) {
    outcome = 'fielders-choice';
  } else if (batterBase) {
    outcome = inferHitOutcomeFromBase(batterBase);
  } else {
    return deriveContactHeuristicResolution(
      { battedBall, batter: { id: batterId } } as AtBatRecord,
      runners,
    );
  }

  const outsRecorded = Math.min(3, outRunnerIds.size);
  let runsScored = scoredRunnerIds.size;
  const hits = HIT_BASES[outcome] != null ? 1 : 0;
  const totalBases = HIT_BASES[outcome] ?? 0;
  const batterOutFinal = outRunnerIds.has(batterId);
  const batterScoredFinal = scoredRunnerIds.has(batterId);

  // ── MLB Rule 5.08(a): Force-out 3rd-out run nullification ──────
  // No run may score when the third out is made by:
  //   (1) The batter-runner being put out before reaching first base, OR
  //   (2) A force play at any base.
  // Also: no run scores on a caught fly that is the 3rd out (batter out).
  const totalOuts = startingOuts + outsRecorded;
  if (totalOuts >= 3 && outsRecorded > 0) {
    // Check: was the inning-ending out a force play or batter-runner out?
    const batterWasOut = outRunnerIds.has(batterId);
    // If batter is out, this is either a fly-out, ground-out at 1B, or DP
    // All are force-out-equivalent situations → void runs
    if (batterWasOut) {
      runsScored = 0;
      scoredRunnerIds.clear();
    } else {
      // Check if the out that made 3 was a force play.
      // With bases loaded and a grounder, all outs at force bases are force plays.
      // Conservative approach: if the batter-runner is still in play (not out)
      // but other runners were forced out, those are force plays.
      // Any force out making the 3rd out voids all runs.
      const forceOutBases = new Set<string>();
      const batterRunning = !outRunnerIds.has(batterId); // batter creates force chain
      if (batterRunning) {
        // Build force chain: batter→1B, R1→2B, R2→3B, R3→home
        const occupiedBefore = new Set(
          runners.map(r => r.base),
        );
        forceOutBases.add('first'); // batter always forced at 1B
        if (occupiedBefore.has('first')) forceOutBases.add('second');
        if (occupiedBefore.has('first') && occupiedBefore.has('second')) forceOutBases.add('third');
        if (occupiedBefore.has('first') && occupiedBefore.has('second') && occupiedBefore.has('third')) forceOutBases.add('home');
      }

      // Check each out event to see if it was at a force base
      let thirdOutIsForce = false;
      for (const snapshot of snapshots) {
        for (const event of snapshot.events) {
          if (event.type === 'runner-out' && outRunnerIds.has(event.runnerId)) {
            if (forceOutBases.has(event.at)) {
              thirdOutIsForce = true;
            }
          }
        }
      }

      if (thirdOutIsForce) {
        runsScored = 0;
        scoredRunnerIds.clear();
      }
    }
  }

  const runnersAfter: HeadlessRunnerState[] = [];
  for (const [runnerId, base] of runnersAfterById) {
    if (outRunnerIds.has(runnerId) || scoredRunnerIds.has(runnerId)) continue;
    runnersAfter.push({ runnerId, base });
  }

  return {
    outcome,
    statDeltas: {
      outsRecorded,
      runsScored,
      rbis: runsScored,
      hits,
      totalBases,
      batterOut: batterOutFinal,
      batterScored: batterScoredFinal && runsScored > 0,
    },
    runnersAfter: sortedRunnersAfter(runnersAfter),
    scoredRunnerIds: Array.from(scoredRunnerIds),
    outRunnerIds: Array.from(outRunnerIds),
    resolver: 'tick-events',
    usedPreRollFallback: false,
  };
}

/**
 * Run one at-bat through tick simulation in headless mode and reduce
 * it to outcome + stat deltas only.
 */
export function resolveAtBatHeadless(
  ab: AtBatRecord,
  defenseRoster: Map<Position, Player>,
  opts: HeadlessTickResolveOptions = {},
): HeadlessAtBatResolution {
  if (!ab.battedBall) {
    return deriveSeedNonBattedResolution(ab, opts.runners ?? []);
  }

  const snapshots = simulateAtBatTick(ab, defenseRoster, opts.teamColor ?? 0x2563eb, {
    ...opts,
    captureEvery: 1,
  });

  return extractTickOutcome(snapshots, ab.batter.id, ab.battedBall, opts.runners ?? []);
}

/**
 * Create a `ResolvePlayFn` that bridges the sim-engine game loop to
 * the tick-engine's headless simulation. Pass the returned function
 * as `opts.resolvePlay` to `simulateGame()`.
 *
 * Usage:
 * ```ts
 * import { simulateGame } from '@baseballczar/sim-engine';
 * import { createResolvePlayBridge } from '@baseballczar/tick-engine';
 *
 * simulateGame(home, away, rng, {
 *   resolvePlay: createResolvePlayBridge(),
 * });
 * ```
 */
export function createResolvePlayBridge(): ResolvePlayFn {
  return (
    ab: AtBatRecord,
    defenseMap: Map<Position, Player>,
    bases: readonly (Player | null)[],
  ): ResolvePlayResult => {
    // Build runners array from bases state
    const runners: { player: Player; base: 'first' | 'second' | 'third' }[] = [];
    if (bases[0]) runners.push({ player: bases[0], base: 'first' });
    if (bases[1]) runners.push({ player: bases[1], base: 'second' });
    if (bases[2]) runners.push({ player: bases[2], base: 'third' });

    const resolution = resolveAtBatHeadless(ab, defenseMap, { runners });

    return {
      outcome: resolution.outcome,
      outsRecorded: resolution.statDeltas.outsRecorded,
      runsScored: resolution.statDeltas.runsScored,
      runnersAfter: resolution.runnersAfter,
      scoredRunnerIds: resolution.scoredRunnerIds,
    };
  };
}
