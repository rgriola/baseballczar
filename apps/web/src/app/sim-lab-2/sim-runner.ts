// Last touched by agent: 2026-05-05T18:04:00Z
// Purpose: Runs a full Sim Lab 2 game deterministically for UI and browser worker.

import {
  simulateFullGame,
} from '@baseballczar/tick-engine/gameOrchestrator';
import { MANAGER_PROFILES } from '@baseballczar/tick-engine/managerProfiles';
import {
  resolveAtBatHeadless,
  type HeadlessAtBatResolution,
} from '@baseballczar/tick-engine/tickAuthority';
import {
  createRng,
} from '@baseballczar/sim-engine/rng';
import {
  generateMatchup,
} from '@baseballczar/sim-engine/randomTeam';
import {
  simulateGame,
} from '@baseballczar/sim-engine/game';
import type {
  AtBatRecord,
  AtBatResult,
  Player,
  Team,
  GameResult,
} from '@baseballczar/sim-engine/types';
import type { Position } from '@baseballczar/sim-engine/config';
import type { ManagerProfileKey } from './worker-protocol';
import type {
  SimRun,
  TickAuthorityAtBatDelta,
  TickAuthorityParitySummary,
} from './sim-run-types';

const starterRotationByTeamId = new Map<number, number>();
const DEFENSE_POSITIONS: Position[] = ['P', 'C', 'B1', 'B2', 'SS', 'B3', 'LF', 'CF', 'RF'];

type RunnerOnBase = {
  player: Player;
  base: 'first' | 'second' | 'third';
};

function isTickAuthorityPhase2Enabled(): boolean {
  const raw = process.env.NEXT_PUBLIC_SIMLAB_TICK_AUTHORITY_PHASE2
    ?? process.env.NEXT_PUBLIC_SIMLAB_TICK_AUTHORITY_PHASE1;
  if (raw == null) return true;

  const value = raw.trim().toLowerCase();
  return value !== '0' && value !== 'false' && value !== 'off';
}

function makeDisabledParitySummary(preRolled: GameResult): TickAuthorityParitySummary {
  let battedBallAtBats = 0;
  for (const ab of preRolled.atBats) {
    if (ab.battedBall) battedBallAtBats++;
  }

  return {
    totalAtBats: preRolled.atBats.length,
    battedBallAtBats,
    tickResolvedBattedBallAtBats: 0,
    battedBallHeuristicFallbacks: 0,
    resultMismatches: 0,
    runMismatches: 0,
    outMismatches: 0,
    totalRunDelta: 0,
    totalOutDelta: 0,
  };
}

function currentStarterIndex(team: Team): number {
  if (team.rotation.length === 0) return 0;
  const stored = starterRotationByTeamId.get(team.id) ?? 0;
  return ((stored % team.rotation.length) + team.rotation.length) % team.rotation.length;
}

function advanceStarterIndex(team: Team, currentIndex: number): void {
  if (team.rotation.length === 0) return;
  starterRotationByTeamId.set(team.id, (currentIndex + 1) % team.rotation.length);
}

function buildDefenseMap(team: Team): Map<Position, Player> {
  const map = new Map<Position, Player>();
  for (let i = 0; i < DEFENSE_POSITIONS.length && i < team.roster.length; i++) {
    map.set(DEFENSE_POSITIONS[i], team.roster[i]);
  }
  return map;
}

function buildPlayerLookup(home: Team, away: Team): Map<number, Player> {
  const players = new Map<number, Player>();

  for (const p of home.roster) players.set(p.id, p);
  for (const p of away.roster) players.set(p.id, p);

  for (const p of home.rotation) players.set(p.id, p);
  for (const p of away.rotation) players.set(p.id, p);

  for (const p of home.lineup) players.set(p.id, p);
  for (const p of away.lineup) players.set(p.id, p);

  return players;
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
    result === 'sac-fly' ||
    result === 'fielders-choice'
  );
}

function seedOutsRecorded(result: AtBatResult): number {
  if (result === 'double-play') return 2;
  return isOutResult(result) ? 1 : 0;
}

function applySeedState(
  ab: AtBatRecord,
  prevRunners: RunnerOnBase[],
): { runnersAfter: RunnerOnBase[]; outsRecorded: number } {
  const runnersAfter: RunnerOnBase[] = [];

  switch (ab.result) {
    case 'single':
      for (const r of prevRunners) {
        if (r.base === 'third') continue;
        if (r.base === 'second') runnersAfter.push({ player: r.player, base: 'third' });
        if (r.base === 'first') runnersAfter.push({ player: r.player, base: 'second' });
      }
      runnersAfter.push({ player: ab.batter, base: 'first' });
      break;

    case 'double':
      for (const r of prevRunners) {
        if (r.base === 'first') runnersAfter.push({ player: r.player, base: 'third' });
      }
      runnersAfter.push({ player: ab.batter, base: 'second' });
      break;

    case 'triple':
      runnersAfter.push({ player: ab.batter, base: 'third' });
      break;

    case 'home-run':
      break;

    case 'walk':
    case 'hbp':
      for (const r of prevRunners) {
        if (r.base === 'first') {
          runnersAfter.push({ player: r.player, base: 'second' });
        } else {
          runnersAfter.push(r);
        }
      }
      runnersAfter.push({ player: ab.batter, base: 'first' });
      break;

    case 'sac-fly':
      for (const r of prevRunners) {
        if (r.base !== 'third') runnersAfter.push(r);
      }
      break;

    case 'double-play':
      for (const r of prevRunners) {
        if (r.base !== 'first') runnersAfter.push(r);
      }
      break;

    case 'fielders-choice':
      for (const r of prevRunners) {
        if (r.base !== 'first') runnersAfter.push(r);
      }
      runnersAfter.push({ player: ab.batter, base: 'first' });
      break;

    case 'reached-on-error':
      for (const r of prevRunners) {
        if (r.base === 'third') continue;
        if (r.base === 'second') runnersAfter.push({ player: r.player, base: 'third' });
        if (r.base === 'first') runnersAfter.push({ player: r.player, base: 'second' });
      }
      runnersAfter.push({ player: ab.batter, base: 'first' });
      break;

    default:
      runnersAfter.push(...prevRunners);
      break;
  }

  return {
    runnersAfter,
    outsRecorded: seedOutsRecorded(ab.result),
  };
}

function applyTickAuthorityPhase2(
  preRolled: GameResult,
  home: Team,
  away: Team,
): {
  authoritativeResult: GameResult;
  atBatDeltas: TickAuthorityAtBatDelta[];
  parity: TickAuthorityParitySummary;
} {
  const playerLookup = buildPlayerLookup(home, away);
  const homeDefense = buildDefenseMap(home);
  const awayDefense = buildDefenseMap(away);

  const patchedAtBats: AtBatRecord[] = [];
  const atBatDeltas: TickAuthorityAtBatDelta[] = [];

  let currentInning = 1;
  let currentHalf: 'top' | 'bottom' = 'top';
  let outs = 0;
  let homeRuns = 0;
  let awayRuns = 0;
  let runnersOnBase: RunnerOnBase[] = [];
  const parity: TickAuthorityParitySummary = {
    totalAtBats: 0,
    battedBallAtBats: 0,
    tickResolvedBattedBallAtBats: 0,
    battedBallHeuristicFallbacks: 0,
    resultMismatches: 0,
    runMismatches: 0,
    outMismatches: 0,
    totalRunDelta: 0,
    totalOutDelta: 0,
  };

  for (let i = 0; i < preRolled.atBats.length; i++) {
    const ab = preRolled.atBats[i];
    parity.totalAtBats++;

    if (i === 0) {
      currentInning = ab.inning;
      currentHalf = ab.half;
      outs = 0;
      runnersOnBase = [];
    } else if (ab.inning !== currentInning || ab.half !== currentHalf) {
      currentInning = ab.inning;
      currentHalf = ab.half;
      outs = 0;
      runnersOnBase = [];
    }

    if (outs >= 3) {
      outs = 0;
      runnersOnBase = [];
    }

    const isHomeBatting = ab.half === 'bottom';
    const defenseMap = isHomeBatting ? awayDefense : homeDefense;
    defenseMap.set('P', ab.pitcher);

    const seedState = applySeedState(ab, runnersOnBase);
    const seedOutsRecorded = Math.max(0, Math.min(3 - outs, seedState.outsRecorded));

    let resolvedResult = ab.result;
    let runsScored = ab.runsScored;
    let rbis = ab.rbis;
    let outsRecorded = seedState.outsRecorded;
    let nextRunners = seedState.runnersAfter;
    let usedTickAuthority = false;
    let resolutionSource: HeadlessAtBatResolution['resolver'] = 'seed-non-batted';

    if (ab.battedBall) {
      parity.battedBallAtBats++;

      const resolution: HeadlessAtBatResolution = resolveAtBatHeadless(ab, defenseMap, {
        teamColor: isHomeBatting ? 0x2a3a6e : 0x1e5631,
        runners: runnersOnBase,
        situation: {
          outs,
          inning: ab.inning,
          half: ab.half,
          scoreDiff: isHomeBatting ? homeRuns - awayRuns : awayRuns - homeRuns,
        },
      });
      resolutionSource = resolution.resolver;
      usedTickAuthority = resolution.resolver !== 'seed-non-batted';

      if (resolution.resolver === 'tick-events') {
        parity.tickResolvedBattedBallAtBats++;
      } else if (resolution.resolver === 'contact-heuristic') {
        parity.battedBallHeuristicFallbacks++;
      }

      resolvedResult = resolution.outcome;
      runsScored = resolution.statDeltas.runsScored;
      rbis = resolution.statDeltas.rbis;
      outsRecorded = resolution.statDeltas.outsRecorded;

      const translatedRunners: RunnerOnBase[] = [];
      for (const runner of resolution.runnersAfter) {
        const player = playerLookup.get(runner.runnerId);
        if (!player) continue;
        translatedRunners.push({ player, base: runner.base });
      }
      nextRunners = translatedRunners;
    }

    const safeOutsRecorded = Math.max(0, Math.min(3 - outs, outsRecorded));

    if (resolvedResult !== ab.result) {
      parity.resultMismatches++;
    }
    if (runsScored !== ab.runsScored) {
      parity.runMismatches++;
      parity.totalRunDelta += runsScored - ab.runsScored;
    }
    if (safeOutsRecorded !== seedOutsRecorded) {
      parity.outMismatches++;
      parity.totalOutDelta += safeOutsRecorded - seedOutsRecorded;
    }

    const patchedAtBat: AtBatRecord = {
      ...ab,
      outs,
      result: resolvedResult,
      runsScored,
      rbis,
    };

    patchedAtBats.push(patchedAtBat);
    atBatDeltas.push({
      atBatIndex: i,
      seedResult: ab.result,
      resolvedResult,
      seedRunsScored: ab.runsScored,
      seedOutsRecorded,
      resolvedRunsScored: runsScored,
      resolvedOutsRecorded: safeOutsRecorded,
      resolutionSource,
      isBattedBall: Boolean(ab.battedBall),
      outsRecorded: safeOutsRecorded,
      runsScored,
      usedTickAuthority,
    });

    runnersOnBase = safeOutsRecorded > 0 && outs + safeOutsRecorded >= 3 ? [] : nextRunners;
    outs = Math.min(3, outs + safeOutsRecorded);

    if (isHomeBatting) {
      homeRuns += runsScored;
    } else {
      awayRuns += runsScored;
    }
  }

  return {
    authoritativeResult: {
      ...preRolled,
      homeRuns,
      awayRuns,
      atBats: patchedAtBats,
    },
    atBatDeltas,
    parity,
  };
}

export function runSim(
  seed: number,
  homeProfileKey: ManagerProfileKey,
  awayProfileKey: ManagerProfileKey,
): SimRun {
  const rng = createRng(seed);
  const { home, away } = generateMatchup(rng);
  const homeStarterIndex = currentStarterIndex(home);
  const awayStarterIndex = currentStarterIndex(away);
  const preRolled = simulateGame(home, away, rng, {
    homeStarterIndex,
    awayStarterIndex,
  });

  // Phase 2 tick-authority is now handled INSIDE simulateFullGame().
  // The orchestrator runs the tick-engine once for visual snapshots AND
  // extracts the authoritative outcome from the same run. No separate
  // headless pass needed — one run, one truth.
  const fullGame = simulateFullGame(preRolled, home, away, {
    homeProfile: MANAGER_PROFILES[homeProfileKey],
    awayProfile: MANAGER_PROFILES[awayProfileKey],
    homeStarterIndex,
    awayStarterIndex,
    captureEvery: 3,
  });

  advanceStarterIndex(home, homeStarterIndex);
  advanceStarterIndex(away, awayStarterIndex);

  return {
    seed,
    result: preRolled,
    home,
    away,
    fullGame,
    tickAuthorityPhase: 2,
    tickAuthorityEnabled: true,
    tickAuthorityDeltas: [],
    tickAuthorityParity: makeDisabledParitySummary(preRolled),
  };
}
