// Last touched by agent: 2026-05-14T09:45:00Z
// Purpose: Defines scheduled sim contract and validates persistence invariants.
// Now validates the engine's native GameResult type directly.

import { z } from 'zod';
import type { GameResult } from '@baseballczar/sim-engine';

export const SIM_VERSION_TICK_FULL = 'tick-engine-full-v1';
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

/** Fields that are cumulative sums of angles/speeds and can legitimately be negative. */
const SIGNED_ANALYTICS_FIELDS = new Set([
  'totalSpray', 'totalLA', 'totalEV', 'totalBatSpeed',
]);

function assertStatsMap<T extends object>(statsMap: Map<number, T>, label: string): void {
  if (!(statsMap instanceof Map)) {
    throw new Error(`${label} must be a Map`);
  }

  for (const [playerId, stats] of statsMap.entries()) {
    assertPositiveInt(playerId, `${label} playerId`);

    for (const [field, rawValue] of Object.entries(stats as Record<string, unknown>)) {
      if (typeof rawValue === 'number') {
        if (SIGNED_ANALYTICS_FIELDS.has(field)) {
          // Analytics accumulators can be negative (e.g. spray angle -90°..+90°)
          if (!Number.isFinite(rawValue)) {
            throw new Error(`${label}.${field} must be a finite number`);
          }
        } else {
          assertNonNegativeFinite(rawValue, `${label}.${field}`);
        }
      }
    }
  }
}

/**
 * Validate an engine GameResult for persistence integrity.
 */
export function assertGameResultContract(result: GameResult): void {
  assertPositiveInt(result.homeTeam.id, 'homeTeam.id');
  assertPositiveInt(result.awayTeam.id, 'awayTeam.id');

  if (result.homeTeam.id === result.awayTeam.id) {
    throw new Error('homeTeam.id and awayTeam.id must differ');
  }

  assertNonNegativeInt(result.homeRuns, 'homeRuns');
  assertNonNegativeInt(result.awayRuns, 'awayRuns');
  assertNonNegativeInt(result.innings, 'innings');

  if (result.innings < 9) {
    throw new Error('innings must be at least 9');
  }

  if (result.homeRuns === result.awayRuns) {
    throw new Error('games must end with a winner (ties are invalid)');
  }

  // Validate stat maps
  assertStatsMap(result.batterStats, 'batterStats');
  assertStatsMap(result.pitcherStats, 'pitcherStats');
  assertStatsMap(result.fielderStats, 'fielderStats');

  // Validate atBats array exists and is non-empty
  if (!Array.isArray(result.atBats) || result.atBats.length === 0) {
    throw new Error('result.atBats must contain at least one at-bat');
  }
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
