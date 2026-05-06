#!/usr/bin/env tsx
// Last touched by agent: 2026-05-05T16:29:50Z
// Purpose: Run sim2 CLI with season/game modes and explicit parameter output.

import { createRequire } from 'node:module';
import {
  createRng,
  formatSeasonReport,
  generateTeam,
  simulateGame,
  simulateSeason,
  type GameResult,
  type Team,
} from '../src';

const require = createRequire(import.meta.url);
const pkg = require('../package.json') as { version?: string };
const SIM_VERSION = `sim2 @baseballczar/sim-engine ${pkg.version ?? 'dev'}`;

type Mode = 'season' | 'game';

type TeamPreset = {
  name: string;
  abbrev: string;
};

const TEAM_PRESETS: TeamPreset[] = [
  { name: 'Eagles', abbrev: 'EGL' },
  { name: 'Wolves', abbrev: 'WLV' },
  { name: 'Sharks', abbrev: 'SHK' },
  { name: 'Falcons', abbrev: 'FLC' },
  { name: 'Titans', abbrev: 'TTN' },
  { name: 'Vipers', abbrev: 'VPR' },
  { name: 'Stallions', abbrev: 'STL' },
  { name: 'Panthers', abbrev: 'PNT' },
  { name: 'Grizzlies', abbrev: 'GRZ' },
  { name: 'Hawks', abbrev: 'HWK' },
  { name: 'Blazers', abbrev: 'BLZ' },
  { name: 'Mustangs', abbrev: 'MST' },
  { name: 'Raptors', abbrev: 'RPT' },
  { name: 'Cobras', abbrev: 'CBR' },
  { name: 'Thunder', abbrev: 'THD' },
  { name: 'Hurricanes', abbrev: 'HRC' },
];

const args = process.argv.slice(2);

function hasFlag(name: string): boolean {
  return args.includes(`--${name}`);
}

function readArg(name: string): string | undefined {
  const idx = args.indexOf(`--${name}`);
  if (idx < 0) return undefined;
  return args[idx + 1];
}

function readIntArg(name: string, fallback: number): number {
  const raw = readArg(name);
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    throw new Error(`Invalid --${name} value: ${raw}`);
  }
  return parsed;
}

function normalizeToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, '');
}

function buildTeamCatalog(seed: number): Team[] {
  const rng = createRng(seed);
  return TEAM_PRESETS.map((preset, index) =>
    generateTeam(rng, index + 1, preset.name, preset.abbrev),
  );
}

function resolveTeam(catalog: Team[], raw: string): Team | undefined {
  const want = normalizeToken(raw);
  return catalog.find((team) => {
    const nameToken = normalizeToken(team.name);
    const abbrevToken = normalizeToken(team.abbrev);
    return nameToken === want || abbrevToken === want;
  });
}

function readStarterIndex(name: string): number | undefined {
  const raw = readArg(name);
  if (!raw) return undefined;
  const slot = Number.parseInt(raw, 10);
  if (!Number.isFinite(slot) || slot < 1 || slot > 5) {
    throw new Error(`Invalid --${name} value: ${raw}. Expected 1..5.`);
  }
  return slot - 1;
}

function pad(n: number, w = 3): string {
  return String(n).padStart(w, ' ');
}

function printHeader(mode: Mode, params: string[]): void {
  console.log('=== Baseball Czar Sim2 ===');
  console.log(`Sim Version: ${SIM_VERSION}`);
  console.log(`Mode: ${mode}`);
  console.log(`Params: ${params.join(', ')}`);
  console.log('');
}

function printUsage(): void {
  console.log('Usage: npm run sim2 -- [options]');
  console.log('');
  console.log('Modes:');
  console.log('  --mode season             Simulate a season (default)');
  console.log('  --mode game               Simulate one game');
  console.log('  --one-game                Alias for --mode game');
  console.log('');
  console.log('Season options:');
  console.log('  --games <n>               Games per team (default: 162)');
  console.log('  --full-season             Force --games 162');
  console.log('  --teams <n>               Number of teams (default: 8)');
  console.log('  --seed <n>                RNG seed (default: 42)');
  console.log('');
  console.log('Game options:');
  console.log('  --home <team>             Home team by name or abbrev (e.g. Eagles, EGL)');
  console.log('  --away <team>             Away team by name or abbrev (e.g. Wolves, WLV)');
  console.log('  --home-starter <1..5>     Rotation slot for home starter');
  console.log('  --away-starter <1..5>     Rotation slot for away starter');
  console.log('  --seed <n>                RNG seed (default: 42)');
  console.log('  --list-teams              Print available team presets and exit');
  console.log('');
  console.log('Examples:');
  console.log('  npm run sim2 -- --full-season --teams 8 --seed 42');
  console.log('  npm run sim2 -- --one-game --home Eagles --away Wolves --seed 42');
}

function printAvailableTeams(): void {
  console.log('Available teams:');
  TEAM_PRESETS.forEach((t, idx) => {
    console.log(`  ${String(idx + 1).padStart(2)}. ${t.name} (${t.abbrev})`);
  });
}

function printSingleGame(result: GameResult): void {
  console.log(`${result.awayTeam.name} ${result.awayRuns} @ ${result.homeTeam.name} ${result.homeRuns} (${result.innings} inn)`);
  console.log(`Winner: ${result.homeRuns > result.awayRuns ? result.homeTeam.name : result.awayTeam.name}`);
  console.log('');

  for (const team of [result.awayTeam, result.homeTeam]) {
    console.log(team.name);
    console.log('  Hitters:                AB   H  2B  3B  HR  BB   K   R RBI');
    for (const player of team.lineup) {
      const stats = result.batterStats.get(player.id);
      if (!stats) continue;
      console.log(
        `  ${(player.lastName + ' ' + player.position).padEnd(22)} ${pad(stats.ab)} ${pad(stats.hits)} ${pad(stats.doubles)} ${pad(stats.triples)} ${pad(stats.homeRuns)} ${pad(stats.walks)} ${pad(stats.strikeouts)} ${pad(stats.runs)} ${pad(stats.rbis)}`,
      );
    }

    console.log('  Pitchers:               BF  Pit  Out   H   R  BB   K  HR');
    for (const player of team.roster) {
      const stats = result.pitcherStats.get(player.id);
      if (!stats || stats.battersFaced === 0) continue;
      console.log(
        `  ${(player.lastName + ' ' + player.position).padEnd(22)} ${pad(stats.battersFaced)} ${pad(stats.pitches)} ${pad(stats.outs)} ${pad(stats.hits)} ${pad(stats.runs)} ${pad(stats.walks)} ${pad(stats.strikeouts)} ${pad(stats.homeRuns)}`,
      );
    }

    console.log('');
  }
}

function runSeason(seed: number): void {
  const fullSeason = hasFlag('full-season');
  const numTeams = readIntArg('teams', 8);
  const gamesPerTeam = fullSeason ? 162 : readIntArg('games', 162);

  printHeader('season', [
    `seed=${seed}`,
    `teams=${numTeams}`,
    `gamesPerTeam=${gamesPerTeam}`,
  ]);

  const result = simulateSeason({ numTeams, gamesPerTeam, seed });
  console.log(formatSeasonReport(result));
}

function runGame(seed: number): void {
  if (hasFlag('list-teams')) {
    printAvailableTeams();
    return;
  }

  const catalog = buildTeamCatalog(seed);

  const homeRaw = readArg('home');
  const awayRaw = readArg('away');

  let homeTeam = homeRaw
    ? resolveTeam(catalog, homeRaw)
    : catalog[Math.abs(seed) % catalog.length];

  if (!homeTeam) {
    throw new Error(`Unknown home team: ${homeRaw}. Use --list-teams to see options.`);
  }

  let awayTeam = awayRaw
    ? resolveTeam(catalog, awayRaw)
    : catalog[(homeTeam.id % catalog.length)];

  if (!awayTeam) {
    throw new Error(`Unknown away team: ${awayRaw}. Use --list-teams to see options.`);
  }

  if (awayTeam.id === homeTeam.id) {
    awayTeam = catalog[(homeTeam.id + 1) % catalog.length];
  }

  if (awayTeam.id === homeTeam.id) {
    throw new Error('Home and away teams must be different.');
  }

  const homeStarterIndex = readStarterIndex('home-starter');
  const awayStarterIndex = readStarterIndex('away-starter');

  const gameSeed = Math.abs(seed * 7919 + homeTeam.id * 31 + awayTeam.id * 17) + 1;
  const result = simulateGame(homeTeam, awayTeam, createRng(gameSeed), {
    homeStarterIndex,
    awayStarterIndex,
  });

  printHeader('game', [
    `seed=${seed}`,
    `home=${homeTeam.name}`,
    `away=${awayTeam.name}`,
    `homeStarter=${homeStarterIndex == null ? 'auto' : homeStarterIndex + 1}`,
    `awayStarter=${awayStarterIndex == null ? 'auto' : awayStarterIndex + 1}`,
  ]);

  printSingleGame(result);
}

function main(): void {
  if (hasFlag('help') || hasFlag('h')) {
    printUsage();
    return;
  }

  const seed = readIntArg('seed', 42);
  const rawMode = hasFlag('one-game') ? 'game' : (readArg('mode') ?? 'season');
  if (rawMode !== 'season' && rawMode !== 'game') {
    throw new Error(`Invalid --mode value: ${rawMode}. Expected season or game.`);
  }

  if (rawMode === 'season') {
    runSeason(seed);
    return;
  }

  runGame(seed);
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
