// Last touched by agent: 2026-05-07T23:35:00Z
// Purpose: Defines scheduled sim contract and validates persistence invariants.

import { z } from 'zod';
import type { GameResult } from '../sim-engine/types';

export const SIM_VERSION_SCHEDULED_V2 = 'scheduled-v2-adapter-v1';
export const SIM_VERSION_SCHEDULED_LEGACY = 'legacy-scheduled-v1';
export const SIM_CONFIG_VERSION = 'CONFIG_V1';

export const scheduledGameMetaSchema = z.object({
  scheduleId: z.number().int().positive(),
  leagueId: z.number().int().positive(),
  seasonNo: z.number().int().positive(),
  seed: z.number().int().positive(),
  simVersion: z.string().trim().min(1),
  configVersion: z.string().trim().min(1),
  generatedAt: z.string().trim().min(1).refine(
    (value) => !Number.isNaN(Date.parse(value)),
    'generatedAt must be an ISO timestamp',
  ),
});

export type ScheduledGameMeta = z.infer<typeof scheduledGameMetaSchema>;

export interface ScheduledGameContract {
  meta: ScheduledGameMeta;
  result: GameResult;
}

interface BuildScheduledGameContractInput {
  scheduleId: number;
  leagueId: number;
  seasonNo: number;
  seed: number;
  simVersion: string;
  configVersion?: string;
  generatedAt?: string;
}

function assertNonNegativeInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative integer`);
  }
}

function assertPositiveInt(value: number, label: string): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
}

function assertNonNegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite number`);
  }
}

function sumPlayedInnings(values: number[], innings: number, label: string): number {
  if (!Array.isArray(values) || values.length <= innings) {
    throw new Error(`${label} must contain inning slots 0..${innings}`);
  }

  let total = 0;
  for (let inning = 1; inning <= innings; inning++) {
    const value = values[inning] ?? 0;
    assertNonNegativeInt(value, `${label}[${inning}]`);
    total += value;
  }
  return total;
}

function assertStatsMap<T extends object>(statsMap: Map<number, T>, label: string): void {
  if (!(statsMap instanceof Map)) {
    throw new Error(`${label} must be a Map`);
  }

  for (const [playerId, stats] of statsMap.entries()) {
    assertPositiveInt(playerId, `${label} playerId`);

    for (const [field, rawValue] of Object.entries(stats as Record<string, unknown>)) {
      if (typeof rawValue === 'number') {
        assertNonNegativeFinite(rawValue, `${label}.${field}`);
      }
    }
  }
}

function assertEventTimeline(result: GameResult): void {
  if (!Array.isArray(result.events) || result.events.length === 0) {
    throw new Error('result.events must contain at least one event');
  }

  let previousHomeRuns = 0;
  let previousVisitorRuns = 0;
  let previousHomeHits = 0;
  let previousVisitorHits = 0;

  for (let i = 0; i < result.events.length; i++) {
    const event = result.events[i];
    assertPositiveInt(event.inning, `events[${i}].inning`);

    if (event.inning > result.innings) {
      throw new Error(`events[${i}].inning exceeds result.innings`);
    }

    assertNonNegativeInt(event.outs, `events[${i}].outs`);
    if (event.outs > 3) {
      throw new Error(`events[${i}].outs must be in range 0..3`);
    }

    assertNonNegativeInt(event.homeRuns, `events[${i}].homeRuns`);
    assertNonNegativeInt(event.visitorRuns, `events[${i}].visitorRuns`);
    assertNonNegativeInt(event.homeHits, `events[${i}].homeHits`);
    assertNonNegativeInt(event.visitorHits, `events[${i}].visitorHits`);

    if (event.homeRuns < previousHomeRuns || event.visitorRuns < previousVisitorRuns) {
      throw new Error(`events[${i}] runs regressed compared with prior event`);
    }

    if (event.homeHits < previousHomeHits || event.visitorHits < previousVisitorHits) {
      throw new Error(`events[${i}] hits regressed compared with prior event`);
    }

    previousHomeRuns = event.homeRuns;
    previousVisitorRuns = event.visitorRuns;
    previousHomeHits = event.homeHits;
    previousVisitorHits = event.visitorHits;
  }

  const last = result.events[result.events.length - 1];
  if (last.homeRuns !== result.homeRuns || last.visitorRuns !== result.visitorRuns) {
    throw new Error('last event scoreboard does not match final runs');
  }

  if (last.homeHits !== result.homeHits || last.visitorHits !== result.visitorHits) {
    throw new Error('last event scoreboard does not match final hits');
  }
}

export function assertGameResultContract(result: GameResult): void {
  assertPositiveInt(result.homeTeamId, 'homeTeamId');
  assertPositiveInt(result.visitorTeamId, 'visitorTeamId');

  if (result.homeTeamId === result.visitorTeamId) {
    throw new Error('homeTeamId and visitorTeamId must differ');
  }

  assertNonNegativeInt(result.homeRuns, 'homeRuns');
  assertNonNegativeInt(result.visitorRuns, 'visitorRuns');
  assertNonNegativeInt(result.homeHits, 'homeHits');
  assertNonNegativeInt(result.visitorHits, 'visitorHits');
  assertNonNegativeInt(result.innings, 'innings');

  if (result.innings < 9) {
    throw new Error('innings must be at least 9');
  }

  if (result.homeRuns === result.visitorRuns) {
    throw new Error('games must end with a winner (ties are invalid)');
  }

  assertPositiveInt(result.winningTeamId, 'winningTeamId');
  assertPositiveInt(result.losingTeamId, 'losingTeamId');

  const expectedWinner = result.homeRuns > result.visitorRuns
    ? result.homeTeamId
    : result.visitorTeamId;
  const expectedLoser = expectedWinner === result.homeTeamId
    ? result.visitorTeamId
    : result.homeTeamId;

  if (result.winningTeamId !== expectedWinner) {
    throw new Error('winningTeamId does not match final score');
  }

  if (result.losingTeamId !== expectedLoser) {
    throw new Error('losingTeamId does not match final score');
  }

  if (!result.scoreBoard?.home || !result.scoreBoard?.visitor) {
    throw new Error('scoreBoard must include home and visitor sections');
  }

  if (result.scoreBoard.home.teamId !== result.homeTeamId) {
    throw new Error('scoreBoard.home.teamId does not match homeTeamId');
  }

  if (result.scoreBoard.visitor.teamId !== result.visitorTeamId) {
    throw new Error('scoreBoard.visitor.teamId does not match visitorTeamId');
  }

  const homeRunsFromBoard = sumPlayedInnings(result.scoreBoard.home.runs, result.innings, 'scoreBoard.home.runs');
  const visitorRunsFromBoard = sumPlayedInnings(
    result.scoreBoard.visitor.runs,
    result.innings,
    'scoreBoard.visitor.runs',
  );
  const homeHitsFromBoard = sumPlayedInnings(result.scoreBoard.home.hits, result.innings, 'scoreBoard.home.hits');
  const visitorHitsFromBoard = sumPlayedInnings(
    result.scoreBoard.visitor.hits,
    result.innings,
    'scoreBoard.visitor.hits',
  );

  if (homeRunsFromBoard !== result.homeRuns || visitorRunsFromBoard !== result.visitorRuns) {
    throw new Error('scoreBoard inning totals do not match final runs');
  }

  if (homeHitsFromBoard !== result.homeHits || visitorHitsFromBoard !== result.visitorHits) {
    throw new Error('scoreBoard inning totals do not match final hits');
  }

  assertNonNegativeInt(result.scoreBoard.home.totalRuns, 'scoreBoard.home.totalRuns');
  assertNonNegativeInt(result.scoreBoard.visitor.totalRuns, 'scoreBoard.visitor.totalRuns');
  assertNonNegativeInt(result.scoreBoard.home.totalHits, 'scoreBoard.home.totalHits');
  assertNonNegativeInt(result.scoreBoard.visitor.totalHits, 'scoreBoard.visitor.totalHits');

  if (result.scoreBoard.home.totalRuns !== result.homeRuns) {
    throw new Error('scoreBoard.home.totalRuns does not match homeRuns');
  }

  if (result.scoreBoard.visitor.totalRuns !== result.visitorRuns) {
    throw new Error('scoreBoard.visitor.totalRuns does not match visitorRuns');
  }

  if (result.scoreBoard.home.totalHits !== result.homeHits) {
    throw new Error('scoreBoard.home.totalHits does not match homeHits');
  }

  if (result.scoreBoard.visitor.totalHits !== result.visitorHits) {
    throw new Error('scoreBoard.visitor.totalHits does not match visitorHits');
  }

  assertStatsMap(result.homePlayerStats, 'homePlayerStats');
  assertStatsMap(result.visitorPlayerStats, 'visitorPlayerStats');
  assertStatsMap(result.homePitcherStats, 'homePitcherStats');
  assertStatsMap(result.visitorPitcherStats, 'visitorPitcherStats');

  assertEventTimeline(result);
}

export function buildScheduledGameContract(
  result: GameResult,
  input: BuildScheduledGameContractInput,
): ScheduledGameContract {
  const meta = scheduledGameMetaSchema.parse({
    scheduleId: input.scheduleId,
    leagueId: input.leagueId,
    seasonNo: input.seasonNo,
    seed: input.seed,
    simVersion: input.simVersion,
    configVersion: input.configVersion ?? SIM_CONFIG_VERSION,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
  });

  assertGameResultContract(result);

  return {
    meta,
    result,
  };
}
