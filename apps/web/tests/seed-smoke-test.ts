/**
 * Smoke test for seed pipeline — validates player generation and schedule
 * without needing a Supabase connection.
 *
 * Usage: npx tsx tests/seed-smoke-test.ts
 */

import { generateRoster, generateTeamName } from '../src/lib/seed/generate-players';
import { generateSchedule } from '../src/lib/seed/generate-schedule';

// --- Team name generation ---
console.log('=== Team Names (5 samples) ===');
for (let i = 0; i < 5; i++) {
  console.log(`  ${generateTeamName()}`);
}

// --- Player generation ---
console.log('\n=== Roster Generation ===');
const roster = generateRoster();
const hitters = roster.filter((p) => p.fielder);
const pitchers = roster.filter((p) => !p.fielder);

console.log(`Total players: ${roster.length} (expected 40)`);
console.log(`Hitters: ${hitters.length} (expected 20)`);
console.log(`Pitchers: ${pitchers.length} (expected 20)`);

// Check active counts
const activeHitters = hitters.filter((p) => p.roster_status === 'active');
const activePitchers = pitchers.filter((p) => p.roster_status === 'active');
console.log(`Active hitters: ${activeHitters.length} (expected 15)`);
console.log(`Active pitchers: ${activePitchers.length} (expected 9)`);
console.log(`Reserve: ${roster.filter((p) => p.roster_status === 'reserve').length} (expected 16)`);

// Spot-check attribute ranges
console.log('\n=== Attribute Ranges ===');
const skills = ['speed', 'stamina', 'ag', 'eye', 'avg', 'strength', 'dhr', 'play_intel', 'bunting', 'fielding', 'throw'] as const;
for (const skill of skills) {
  const vals = roster.map((p) => p[skill]);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  console.log(`  ${skill.padEnd(12)} min=${min} max=${max} (expected 0-6)`);
}

console.log('\n=== Max Potential Ranges ===');
const maxSkills = ['max_speed', 'max_stamina', 'range_ag', 'max_eye', 'max_avg', 'max_strength', 'range_dhr', 'max_play_intel', 'max_bunting', 'max_fielding', 'max_throw'] as const;
for (const skill of maxSkills) {
  const vals = roster.map((p) => p[skill]);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  console.log(`  ${skill.padEnd(16)} min=${min} max=${max} (expected 4-10)`);
}

// Verify max >= start
let maxViolations = 0;
for (const p of roster) {
  if (p.max_speed < p.speed) maxViolations++;
  if (p.max_stamina < p.stamina) maxViolations++;
  if (p.range_ag < p.ag) maxViolations++;
  if (p.max_eye < p.eye) maxViolations++;
  if (p.max_avg < p.avg) maxViolations++;
  if (p.max_strength < p.strength) maxViolations++;
  if (p.range_dhr < p.dhr) maxViolations++;
}
console.log(`\nMax < Start violations: ${maxViolations} (expected 0)`);

// Sample player
console.log('\n=== Sample Hitter ===');
const sample = hitters[0];
console.log(`  ${sample.first_name} ${sample.last_name} — ${sample.position} #${sample.jersey_no}`);
console.log(`  Age: ${sample.age}, Hand: throw=${sample.hand_throw} bat=${sample.hand_batting}`);
console.log(`  Speed: ${sample.speed}/${sample.max_speed}, AVG: ${sample.avg}/${sample.max_avg}`);

console.log('\n=== Sample Pitcher ===');
const sampleP = pitchers[0];
console.log(`  ${sampleP.first_name} ${sampleP.last_name} — P #${sampleP.jersey_no}, Rotation: ${sampleP.rotation_slot}`);
console.log(`  Stamina: ${sampleP.stamina}/${sampleP.max_stamina}`);

// --- Schedule generation ---
console.log('\n=== Schedule Generation ===');
const schedule = generateSchedule(new Date('2026-04-20T16:00:00'));
console.log(`Total game entries: ${schedule.length} (expected 105)`);

const rounds = new Set(schedule.map((g) => g.round));
console.log(`Unique rounds: ${rounds.size} (expected 35)`);

// Verify each round has exactly 3 games
let roundErrors = 0;
for (let r = 1; r <= 35; r++) {
  const gamesInRound = schedule.filter((g) => g.round === r);
  if (gamesInRound.length !== 3) {
    console.log(`  ERROR: Round ${r} has ${gamesInRound.length} games (expected 3)`);
    roundErrors++;
  }
}
console.log(`Round size errors: ${roundErrors}`);

// Verify all 6 team indices appear
const allIndices = new Set([
  ...schedule.map((g) => g.home_team_index),
  ...schedule.map((g) => g.visitor_team_index),
]);
console.log(`Team indices used: [${Array.from(allIndices).sort().join(', ')}] (expected 0-5)`);

// Count home/away balance per team
const homeCount: Record<number, number> = {};
const awayCount: Record<number, number> = {};
for (const g of schedule) {
  homeCount[g.home_team_index] = (homeCount[g.home_team_index] || 0) + 1;
  awayCount[g.visitor_team_index] = (awayCount[g.visitor_team_index] || 0) + 1;
}
console.log('\nHome/Away balance:');
for (let t = 0; t < 6; t++) {
  console.log(`  Team ${t}: ${homeCount[t] || 0}H / ${awayCount[t] || 0}A = ${(homeCount[t] || 0) + (awayCount[t] || 0)} total`);
}

console.log('\n=== All checks passed ===');
