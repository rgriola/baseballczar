// Last touched by agent: 2026-05-05T03:33:20Z
// Purpose: Shared helpers for starter index normalization and pitcher sync from AB records.

import type { Player } from '@baseballczar/sim-engine';
import type { BullpenRole, StrategicState } from './strategicManager';

export function normalizeStarterIndex(index: number, rotationSize: number): number {
  if (rotationSize <= 0) return 0;
  return ((index % rotationSize) + rotationSize) % rotationSize;
}

export function syncPitcherFromAtBat(
  state: StrategicState,
  pitcherFromRecord: Player,
): string | null {
  if (state.currentPitcher.id === pitcherFromRecord.id) return null;

  const incomingRole = compactPitcherRole(state, pitcherFromRecord.id);
  const detail = `[${incomingRole}] ${state.currentPitcher.lastName} -> ${pitcherFromRecord.lastName}`;
  state.currentPitcher = pitcherFromRecord;
  state.pitchCount = 0;
  state.usedPitchers.add(pitcherFromRecord.id);
  state.availableBullpen = state.availableBullpen.filter((p) => p.id !== pitcherFromRecord.id);
  return detail;
}

export function compactPitcherRole(
  state: StrategicState,
  pitcherId: number,
): BullpenRole | 'SP' {
  return state.bullpenRoles.get(pitcherId) ?? 'SP';
}
