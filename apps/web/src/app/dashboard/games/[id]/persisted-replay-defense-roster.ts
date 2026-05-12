// Last touched by agent: 2026-05-07T22:40:33Z
// Purpose: Maps persisted DB skills to replay fielder/runner motion profiles.

import {
  CONFIG,
  FIELDER_POSITIONS_FT,
  sprintFtPerSec,
  throwVelocityMph,
  type Position,
} from '@baseballczar/sim-engine';
import type { FielderEntity } from '@baseballczar/tick-engine';
import type { RunnerMotionProfile, RunnerProfileResolver } from './persisted-replay-motion';

type PersistedPlayerSummary = {
  first_name?: string | null;
  last_name?: string | null;
  hand_batting?: number | null;
  hand_throw?: number | null;
  speed?: number | null;
  stamina?: number | null;
  ag?: number | null;
  eye?: number | null;
  avg?: number | null;
  strength?: number | null;
  play_intel?: number | null;
  bunting?: number | null;
  fielding?: number | null;
  throw?: number | null;
};

export type ReplayPlayerSummary = PersistedPlayerSummary;

type PersistedHittingLike = {
  team_id: number;
  player_id: number;
  position: string | null;
  players?: PersistedPlayerSummary | PersistedPlayerSummary[] | null;
};

type PersistedPitchingLike = {
  team_id: number;
  player_id: number;
  pitch_app?: number | null;
  players?: PersistedPlayerSummary | PersistedPlayerSummary[] | null;
};

type PersistedSkillRow = {
  player_id: number;
  players?: PersistedPlayerSummary | PersistedPlayerSummary[] | null;
};

type FielderProfile = {
  playerId: number;
  speedSkill: number;
  agilitySkill: number;
  fieldingSkill: number;
  throwingSkill: number;
  playIntelligenceSkill: number;
};

const DEFENSE_POSITIONS: Position[] = ['P', 'C', 'B1', 'B2', 'SS', 'B3', 'LF', 'CF', 'RF'];

function clampSkill(value: number | null | undefined, fallback = 5): number {
  const raw = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(1, Math.min(10, Math.round(raw)));
}

function turnRateFromAgility(skill: number): number {
  return 4 + (skill - 1) * 0.35;
}

function facingToHome(pos: { x: number; y: number }): number {
  return Math.atan2(-pos.y, -pos.x);
}

function firstPlayerSummary(
  players: PersistedPlayerSummary | PersistedPlayerSummary[] | null | undefined,
): PersistedPlayerSummary | null {
  if (Array.isArray(players)) return players[0] ?? null;
  if (players && typeof players === 'object') return players;
  return null;
}

function canonicalName(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9]/g, '');
}

function playerNameKeys(summary: PersistedPlayerSummary | null): string[] {
  if (!summary) return [];
  const first = (summary.first_name ?? '').trim();
  const last = (summary.last_name ?? '').trim();
  const out = new Set<string>();

  if (first && last) {
    out.add(canonicalName(`${first} ${last}`));
    out.add(canonicalName(`${first.charAt(0)} ${last}`));
    out.add(canonicalName(`${first.charAt(0)}. ${last}`));
  }
  if (last) out.add(canonicalName(last));

  return Array.from(out).filter((key) => key.length > 0);
}

function runnerProfileFromSummary(summary: PersistedPlayerSummary | null): RunnerMotionProfile {
  const speedSkill = clampSkill(summary?.speed, 5);
  const agilitySkill = clampSkill(summary?.ag, 5);
  return {
    speedFps: sprintFtPerSec(speedSkill),
    agility: agilitySkill,
    turnRateRad: turnRateFromAgility(agilitySkill),
  };
}

function toDefensePosition(positionRaw: string | null): Position | null {
  const position = (positionRaw ?? '').trim().toUpperCase();
  if (position === 'P') return 'P';
  if (position === 'C') return 'C';
  if (position === '1B' || position === 'B1') return 'B1';
  if (position === '2B' || position === 'B2') return 'B2';
  if (position === 'SS') return 'SS';
  if (position === '3B' || position === 'B3') return 'B3';
  if (position === 'LF') return 'LF';
  if (position === 'CF') return 'CF';
  if (position === 'RF') return 'RF';
  return null;
}

function profileFromRow(
  playerId: number,
  players: PersistedPlayerSummary | PersistedPlayerSummary[] | null | undefined,
): FielderProfile {
  const summary = firstPlayerSummary(players);
  const speedSkill = clampSkill(summary?.speed, 5);
  const agilitySkill = clampSkill(summary?.ag, 5);
  const fieldingSkill = clampSkill(summary?.fielding, 5);
  const throwingSkill = clampSkill(summary?.throw, fieldingSkill);
  const playIntelligenceSkill = clampSkill(summary?.play_intel, 5);

  return {
    playerId,
    speedSkill,
    agilitySkill,
    fieldingSkill,
    throwingSkill,
    playIntelligenceSkill,
  };
}

export function buildDefenseFieldersFromRows(
  teamColor: number,
  teamId: number,
  hittingRows: PersistedHittingLike[],
  pitchingRows: PersistedPitchingLike[],
): FielderEntity[] {
  const byPos = new Map<Position, FielderProfile>();

  const teamPitching = pitchingRows
    .filter((row) => Number(row.team_id) === teamId)
    .slice()
    .sort((a, b) => Number(a.pitch_app ?? 0) - Number(b.pitch_app ?? 0));

  if (teamPitching.length > 0) {
    const starter = teamPitching[0];
    byPos.set('P', profileFromRow(Number(starter.player_id), starter.players));
  }

  for (const row of hittingRows) {
    if (Number(row.team_id) !== teamId) continue;
    const position = toDefensePosition(row.position);
    if (!position) continue;
    if (position === 'P' && byPos.has('P')) continue;
    if (!byPos.has(position)) {
      byPos.set(position, profileFromRow(Number(row.player_id), row.players));
    }
  }

  return DEFENSE_POSITIONS.map((position, idx) => {
    const profile = byPos.get(position);
    const speedSkill = profile?.speedSkill ?? 5;
    const agilitySkill = profile?.agilitySkill ?? 5;
    const fieldingSkill = profile?.fieldingSkill ?? 5;
    const throwingSkill = profile?.throwingSkill ?? fieldingSkill;
    const homePos = FIELDER_POSITIONS_FT[position];

    return {
      position,
      pos: { ...homePos },
      homePos: { ...homePos },
      state: { type: 'idle' },
      speedFps: sprintFtPerSec(speedSkill),
      agility: agilitySkill,
      facingRad: facingToHome(homePos),
      turnRateRad: turnRateFromAgility(agilitySkill),
      throwVeloFps: throwVelocityMph(position, throwingSkill) * CONFIG.flight.mphToFps,
      throwingSkill,
      defense: fieldingSkill,
      playIntelligence: profile?.playIntelligenceSkill ?? 5,
      playerId: profile?.playerId ?? -(idx + 1),
      jerseyNumber: profile?.playerId ?? 0,
      teamColor,
    };
  });
}

export function buildRunnerSkillResolver(
  hittingRows: PersistedHittingLike[],
  pitchingRows: PersistedPitchingLike[],
): RunnerProfileResolver {
  const byId = new Map<number, RunnerMotionProfile>();
  const rows: PersistedSkillRow[] = [...hittingRows, ...pitchingRows];

  for (const row of rows) {
    const playerId = Number(row.player_id);
    if (!Number.isFinite(playerId) || byId.has(playerId)) continue;
    byId.set(playerId, runnerProfileFromSummary(firstPlayerSummary(row.players)));
  }

  return (runnerId: number) => byId.get(Number(runnerId));
}

export function buildRunnerNameResolver(
  hittingRows: PersistedHittingLike[],
  pitchingRows: PersistedPitchingLike[],
): (displayName: string) => RunnerMotionProfile | undefined {
  const byName = new Map<string, RunnerMotionProfile>();
  const rows: PersistedSkillRow[] = [...hittingRows, ...pitchingRows];

  for (const row of rows) {
    const summary = firstPlayerSummary(row.players);
    const profile = runnerProfileFromSummary(summary);
    for (const key of playerNameKeys(summary)) {
      if (!byName.has(key)) byName.set(key, profile);
    }
  }

  return (displayName: string) => byName.get(canonicalName(displayName));
}

export function buildPlayerNameSummaryResolver(
  hittingRows: PersistedHittingLike[],
  pitchingRows: PersistedPitchingLike[],
): (displayName: string) => ReplayPlayerSummary | undefined {
  const byName = new Map<string, ReplayPlayerSummary>();
  const rows: PersistedSkillRow[] = [...hittingRows, ...pitchingRows];

  for (const row of rows) {
    const summary = firstPlayerSummary(row.players);
    if (!summary) continue;
    for (const key of playerNameKeys(summary)) {
      if (!byName.has(key)) byName.set(key, summary);
    }
  }

  return (displayName: string) => byName.get(canonicalName(displayName));
}
