/**
 * Player valuation — translated from playerTrade.java.
 *
 * Original formula: $22,000 × (speed + stamina + play_intel + avg + strength + eye + bunting + throw + fielding)
 * 9 skills, each 1-10 → value range $198,000 (all 1s) to $1,980,000 (all 10s).
 */

const PER_SKILL_VALUE = 22000;

const SKILL_KEYS = [
  'speed', 'stamina', 'play_intel', 'avg', 'strength',
  'eye', 'bunting', 'throw', 'fielding',
] as const;

export interface ValuablePlayer {
  speed: number;
  stamina: number;
  play_intel: number;
  avg: number;
  strength: number;
  eye: number;
  bunting: number;
  throw: number;
  fielding: number;
}

/**
 * Calculate a player's market value based on their 9 base skills.
 */
export function calculatePlayerValue(player: ValuablePlayer): number {
  let total = 0;
  for (const key of SKILL_KEYS) {
    total += player[key];
  }
  return Math.round(total * PER_SKILL_VALUE);
}

/**
 * Map a DB player row to the ValuablePlayer interface.
 * DB columns use short names: speed, stamina, play_intel, avg, strength, eye, bunting, throw, fielding.
 */
export function playerValueFromRow(row: {
  speed: number;
  stamina: number;
  play_intel: number;
  avg: number;
  strength: number;
  eye: number;
  bunting: number;
  throw: number;
  fielding: number;
}): number {
  return calculatePlayerValue(row);
}
