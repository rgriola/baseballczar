/**
 * Shared types and helpers used across AI modules.
 */
import type { Point2D } from '../entities';
import { dist2D } from '../spatial';
import { BASE_POS } from '../runnerAI';
import type { BaseName } from '../fieldGeometry';

// ─── Game situation awareness ────────────────────────────────────

export interface GameSituation {
  outs: number;
  inning: number;
  half: 'top' | 'bottom';
  scoreDiff: number;  // positive = leading
}

// ─── Shared helpers ──────────────────────────────────────────────

export function closestBaseTo(pt: Point2D): BaseName {
  let best: BaseName = 'home';
  let bestDist = Infinity;
  for (const [name, pos] of Object.entries(BASE_POS)) {
    const d = dist2D(pt, pos);
    if (d < bestDist) {
      bestDist = d;
      best = name as BaseName;
    }
  }
  return best;
}

export function baseIndex(base: string): number {
  return ['home', 'first', 'second', 'third'].indexOf(base);
}
