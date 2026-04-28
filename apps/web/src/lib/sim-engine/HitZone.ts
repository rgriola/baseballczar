import { AtBatOutcome, type HitZone } from './types';

/**
 * Probability distribution for where a ball is hit, keyed by outcome.
 *
 * Values are weights (not normalized) — picked proportionally. Tuned to
 * mirror real-baseball patterns:
 *   - Singles: spread fairly evenly across the outfield, slight pull bias.
 *   - Doubles: concentrated in the gaps and down the lines (off the wall).
 *   - Triples: almost always down the lines, especially RF (longest throw
 *     from RF corner to 3B). LF triples are rarer because the throw to
 *     3B is short. A small share land in straightaway CF (the deepest
 *     part of the park).
 *   - HRs: distributed across the OF; pull-side bias is mild.
 */
const ZONE_WEIGHTS: Record<Exclude<AtBatOutcome, AtBatOutcome.Walk | AtBatOutcome.Strikeout>, Partial<Record<HitZone, number>>> = {
  [AtBatOutcome.Single]: {
    LF_LINE: 1,
    LF: 3,
    LCF: 3,
    CF: 4,
    RCF: 3,
    RF: 3,
    RF_LINE: 1,
  },
  [AtBatOutcome.Double]: {
    LF_LINE: 3,
    LF: 1,
    LCF: 4,
    CF: 2,
    RCF: 4,
    RF: 1,
    RF_LINE: 3,
  },
  [AtBatOutcome.Triple]: {
    LF_LINE: 4,
    LF: 0,
    LCF: 0,
    CF: 2,
    RCF: 0,
    RF: 0,
    RF_LINE: 9,
  },
  [AtBatOutcome.HomeRun]: {
    LF_LINE: 1,
    LF: 3,
    LCF: 2,
    CF: 3,
    RCF: 2,
    RF: 3,
    RF_LINE: 1,
  },
  [AtBatOutcome.GroundOut]: {
    INFIELD: 1,
  },
};

/**
 * Pick a hit zone for a given at-bat outcome. Returns undefined for
 * non-batted-ball events (Walks, Strikeouts).
 */
export function pickHitZone(outcome: AtBatOutcome): HitZone | undefined {
  if (outcome === AtBatOutcome.Walk || outcome === AtBatOutcome.Strikeout) {
    return undefined;
  }
  const weights = ZONE_WEIGHTS[outcome];
  const entries = Object.entries(weights) as [HitZone, number][];
  const total = entries.reduce((s, [, w]) => s + w, 0);
  let r = Math.random() * total;
  for (const [zone, w] of entries) {
    r -= w;
    if (r <= 0) return zone;
  }
  return entries[entries.length - 1][0];
}
