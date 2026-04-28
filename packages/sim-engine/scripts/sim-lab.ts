#!/usr/bin/env tsx
/**
 * Sim-Lab CLI runner.
 *
 *   npx tsx scripts/sim-lab.ts                      # 162 games, default seed
 *   npx tsx scripts/sim-lab.ts --games 10           # 10 games
 *   npx tsx scripts/sim-lab.ts --seed 42            # reproducible
 *   npx tsx scripts/sim-lab.ts --verbose            # log boxscore of game 1
 *   npx tsx scripts/sim-lab.ts --pbp                # print play-by-play of game 1
 *
 * Tweak the simulation by editing packages/sim-engine/src/config.ts and re-running.
 */
import {
  CONFIG, createRng, generateMatchup, simulateGame,
  aggregate, formatReport, buildEvents,
  type GameResult, type Team,
} from '../src';
import { writeFileSync } from 'node:fs';

function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return fallback;
  return process.argv[i + 1];
}
function flag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

const games = parseInt(arg('games', '162')!, 10);
const seed  = parseInt(arg('seed', String(Date.now() & 0xffff))!, 10);
const verbose = flag('verbose');
const pbp = flag('pbp');
const eventsPath = arg('events');

console.log(`sim-lab: ${games} game(s), seed=${seed}\n`);

const rng = createRng(seed);
const results: GameResult[] = [];

for (let i = 0; i < games; i++) {
  const { home, away } = generateMatchup(rng);
  const g = simulateGame(home, away, rng);
  results.push(g);
}

const report = aggregate(results);
console.log(formatReport(report));

if (verbose && results.length > 0) {
  console.log('\n─── GAME 1 BOXSCORE ───');
  printBoxscore(results[0]);
}

if (pbp && results.length > 0) {
  console.log('\n─── GAME 1 PLAY-BY-PLAY ───');
  printPbp(results[0]);
}

if (eventsPath && results.length > 0) {
  const events = buildEvents(results[0]);
  writeFileSync(eventsPath, JSON.stringify({
    game: {
      home: results[0].homeTeam.name,
      away: results[0].awayTeam.name,
      finalHome: results[0].homeRuns,
      finalAway: results[0].awayRuns,
      innings: results[0].innings,
    },
    events,
  }, null, 2));
  console.log(`\n─── GAME 1 EVENT LOG ───`);
  console.log(`Wrote ${events.length} events to ${eventsPath}`);
  // Quick sanity summary
  const counts: Record<string, number> = {};
  for (const e of events) counts[e.type] = (counts[e.type] ?? 0) + 1;
  for (const [k, v] of Object.entries(counts).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${k.padEnd(20)} ${v}`);
  }
}

function printBoxscore(g: GameResult): void {
  console.log(`${g.awayTeam.name} ${g.awayRuns} @ ${g.homeTeam.name} ${g.homeRuns}  (${g.innings} inn)`);
  console.log('');
  for (const team of [g.awayTeam, g.homeTeam] as Team[]) {
    console.log(team.name);
    console.log('  Hitters:                AB   H  2B  3B  HR  BB   K   R RBI');
    for (const p of team.lineup) {
      const s = g.batterStats.get(p.id);
      if (!s) continue;
      console.log(`  ${(p.lastName + ' ' + p.position).padEnd(22)} ${pad(s.ab)} ${pad(s.hits)} ${pad(s.doubles)} ${pad(s.triples)} ${pad(s.homeRuns)} ${pad(s.walks)} ${pad(s.strikeouts)} ${pad(s.runs)} ${pad(s.rbis)}`);
    }
    console.log('  Pitchers:               BF  Pit  Out   H   R  BB   K  HR');
    for (const p of team.roster) {
      const s = g.pitcherStats.get(p.id);
      if (!s || s.battersFaced === 0) continue;
      console.log(`  ${(p.lastName + ' ' + p.position).padEnd(22)} ${pad(s.battersFaced)} ${pad(s.pitches)} ${pad(s.outs)} ${pad(s.hits)} ${pad(s.runs)} ${pad(s.walks)} ${pad(s.strikeouts)} ${pad(s.homeRuns)}`);
    }
    console.log('');
  }
}

function pad(n: number, w = 3): string { return String(n).padStart(w, ' '); }

function printPbp(g: GameResult): void {
  let lastInning = -1;
  let lastHalf = '';
  for (const ab of g.atBats) {
    if (ab.inning !== lastInning || ab.half !== lastHalf) {
      console.log(`\n--- ${ab.half === 'top' ? 'Top' : 'Bot'} ${ab.inning} ---`);
      lastInning = ab.inning; lastHalf = ab.half;
    }
    const c = ab.pitches.length === 0 ? '' :
      `(${ab.pitches[ab.pitches.length - 1].balls}-${ab.pitches[ab.pitches.length - 1].strikes}, ${ab.pitches.length}p)`;
    const bb = ab.battedBall
      ? ` [${ab.battedBall.exitVeloMph.toFixed(0)}mph ${ab.battedBall.launchAngleDeg.toFixed(0)}° ${ab.battedBall.distanceFt.toFixed(0)}ft, ${spray(ab.battedBall.sprayAngleDeg)}]`
      : '';
    const fb = ab.fieldedBy ? ` → ${ab.fieldedBy}` : '';
    const rbi = ab.runsScored ? ` (${ab.runsScored} R)` : '';
    console.log(`  ${ab.batter.lastName.padEnd(12)} vs ${ab.pitcher.lastName.padEnd(12)} ${c.padEnd(14)} ${ab.result}${fb}${bb}${rbi}`);
  }
}

function spray(deg: number): string {
  if (deg < 0)  return 'foul-L';
  if (deg < 22) return 'LF-line';
  if (deg < 35) return 'LF';
  if (deg < 55) return 'CF';
  if (deg < 68) return 'RF';
  if (deg < 90) return 'RF-line';
  return 'foul-R';
}
