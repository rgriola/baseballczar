// Last touched by agent: 2026-05-05T18:04:00Z
// Purpose: Shared simulation result types for Sim Lab page, worker, and runner.

import type { FullGameResult } from '@baseballczar/tick-engine/gameOrchestrator';
import type { AtBatResult, GameResult, Team } from '@baseballczar/sim-engine/types';

export type TickAuthorityResolver = 'tick-events' | 'contact-heuristic' | 'seed-non-batted';

export interface TickAuthorityAtBatDelta {
  atBatIndex: number;
  seedResult: AtBatResult;
  resolvedResult: AtBatResult;
  seedRunsScored: number;
  seedOutsRecorded: number;
  resolvedRunsScored: number;
  resolvedOutsRecorded: number;
  resolutionSource: TickAuthorityResolver;
  isBattedBall: boolean;
  outsRecorded: number;
  runsScored: number;
  usedTickAuthority: boolean;
}

export interface TickAuthorityParitySummary {
  totalAtBats: number;
  battedBallAtBats: number;
  tickResolvedBattedBallAtBats: number;
  battedBallHeuristicFallbacks: number;
  resultMismatches: number;
  runMismatches: number;
  outMismatches: number;
  totalRunDelta: number;
  totalOutDelta: number;
}

export interface SimRun {
  seed: number;
  result: GameResult;
  home: Team;
  away: Team;
  fullGame: FullGameResult;
  tickAuthorityPhase: 0 | 2;
  tickAuthorityEnabled: boolean;
  tickAuthorityDeltas: TickAuthorityAtBatDelta[];
  tickAuthorityParity: TickAuthorityParitySummary;
}
