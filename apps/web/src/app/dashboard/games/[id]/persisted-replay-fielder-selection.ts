// Last touched by agent: 2026-05-07T22:45:00Z
// Purpose: Resolves the most plausible fielder for persisted replay ball locations.

import { type Position } from '@baseballczar/sim-engine';
import type { FielderEntity } from '@baseballczar/tick-engine';

type Point2D = { x: number; y: number };

const ZONE_DEFAULT: Record<string, Position> = {
  LF_LINE: 'LF',
  LF: 'LF',
  LCF: 'CF',
  CF: 'CF',
  RCF: 'CF',
  RF: 'RF',
  RF_LINE: 'RF',
  INFIELD: 'SS',
};

const ZONE_CANDIDATES: Record<string, Position[]> = {
  LF_LINE: ['LF', 'B3', 'SS'],
  LF: ['LF', 'SS', 'B3'],
  LCF: ['CF', 'LF', 'SS', 'B2'],
  CF: ['CF', 'LF', 'RF'],
  RCF: ['CF', 'RF', 'B2', 'SS'],
  RF: ['RF', 'B2', 'B1'],
  RF_LINE: ['RF', 'B1', 'B2'],
  // Exclude B1 here because our ground-out throw sequence currently
  // models force outs via throw to first, not unassisted 1B putouts.
  INFIELD: ['P', 'C', 'B3', 'SS', 'B2'],
};

function normalizeZone(zoneRaw: string | null): string {
  return (zoneRaw ?? 'CF').trim().toUpperCase();
}

function distanceFt(a: Point2D, b: Point2D): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function arrivalScoreSec(fielder: FielderEntity, zone: string, ballPos: Point2D): number {
  const speed = Math.max(1, fielder.speedFps);
  const baseSec = distanceFt(fielder.pos, ballPos) / speed;

  // Smaller reaction tax for better defenders.
  let score = baseSec + Math.max(0, 7 - fielder.defense) * 0.025;

  if (zone === 'INFIELD') {
    if (fielder.position === 'C' && ballPos.y > 24) {
      score += 0.8;
    }

    // Pitchers are favored on bunts/choppers but penalized on deeper infield balls.
    if (fielder.position === 'P' && ballPos.y > 78) {
      score += 0.9;
    }

    // Strongly discourage opposite-side middle-infielder assignments on clear pull-side balls.
    if (
      Math.abs(ballPos.x) >= 14
      && Math.abs(fielder.homePos.x) >= 8
      && fielder.homePos.x * ballPos.x < 0
    ) {
      score += 0.5;
    }
  }

  return score;
}

function selectNearestCandidate(
  defenseFrame: FielderEntity[],
  zone: string,
  ballPos: Point2D,
  candidates: Position[],
): Position | null {
  const pool = defenseFrame.filter((fielder) => candidates.includes(fielder.position));
  if (pool.length === 0) return null;

  let best = pool[0];
  let bestScore = arrivalScoreSec(best, zone, ballPos);

  for (let i = 1; i < pool.length; i++) {
    const candidate = pool[i];
    const score = arrivalScoreSec(candidate, zone, ballPos);
    if (score < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best.position;
}

export function resolvePersistedZoneFielder(
  zoneRaw: string | null,
  ballPos: Point2D,
  defenseFrame: FielderEntity[],
): Position {
  const zone = normalizeZone(zoneRaw);
  const fallback = ZONE_DEFAULT[zone] ?? 'CF';

  if (!Array.isArray(defenseFrame) || defenseFrame.length === 0) {
    return fallback;
  }

  const candidates = ZONE_CANDIDATES[zone] ?? [fallback];
  const selected = selectNearestCandidate(defenseFrame, zone, ballPos, candidates);
  return selected ?? fallback;
}
