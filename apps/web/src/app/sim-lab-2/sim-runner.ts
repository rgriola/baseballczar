// Last touched by agent: 2026-05-05T18:04:00Z
// Purpose: Runs a full Sim Lab 2 game deterministically for UI and browser worker.

import {
  simulateFullGame,
} from '@baseballczar/tick-engine/gameOrchestrator';
import { MANAGER_PROFILES } from '@baseballczar/tick-engine/managerProfiles';
import {
  createRng,
} from '@baseballczar/sim-engine/rng';
import {
  generateMatchup,
} from '@baseballczar/sim-engine/randomTeam';
import type {
  Team,
  GameResult,
} from '@baseballczar/sim-engine/types';
import type { ManagerProfileKey } from './worker-protocol';
import type {
  SimRun,
  TickAuthorityParitySummary,
} from './sim-run-types';

const starterRotationByTeamId = new Map<number, number>();

function makeDisabledParitySummary(result: GameResult): TickAuthorityParitySummary {
  return {
    totalAtBats: result.atBats.length,
    battedBallAtBats: 0,
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

export function runSim(
  seed: number,
  homeProfileKey: ManagerProfileKey,
  awayProfileKey: ManagerProfileKey,
): SimRun {
  const rng = createRng(seed);
  const { home, away } = generateMatchup(rng);
  const homeStarterIndex = currentStarterIndex(home);
  const awayStarterIndex = currentStarterIndex(away);

  // The orchestrator now OWNS the game loop. No pre-rolling.
  // It calls simulateAtBat() per-AB and uses tick-engine physics
  // as the sole authority for batted-ball outcomes.
  const fullGame = simulateFullGame(rng, home, away, {
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
    result: fullGame.gameResult,
    home,
    away,
    fullGame,
    tickAuthorityPhase: 2,
    tickAuthorityEnabled: true,
    tickAuthorityDeltas: [],
    tickAuthorityParity: makeDisabledParitySummary(fullGame.gameResult),
  };
}
