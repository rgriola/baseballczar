#!/usr/bin/env npx tsx
/**
 * Simulate a full baseball season and print standings + stat leaders.
 *
 * Usage:
 *   npx tsx scripts/sim-season.ts
 *   npx tsx scripts/sim-season.ts --teams 8 --games 162 --seed 42
 *   npx tsx scripts/sim-season.ts --teams 4 --games 20 --seed 1   # quick test
 */
import { simulateSeason, formatSeasonReport } from '../src/season';

// Parse CLI args
const args = process.argv.slice(2);
function getArg(name: string, fallback: number): number {
  const idx = args.indexOf(`--${name}`);
  if (idx >= 0 && args[idx + 1]) return parseInt(args[idx + 1], 10);
  return fallback;
}

const config = {
  numTeams: getArg('teams', 8),
  gamesPerTeam: getArg('games', 162),
  seed: getArg('seed', 42),
};

console.log(`Simulating season: ${config.numTeams} teams, ${config.gamesPerTeam} games/team, seed ${config.seed}...`);
console.log('');

const result = simulateSeason(config);
console.log(formatSeasonReport(result));
