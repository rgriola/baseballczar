import { simulateGame, type TeamInput } from '../src/lib/sim-engine';

function randSkill(min: number, max: number): number {
  return Math.round((min + Math.random() * (max - min)) * 10) / 10;
}

function makeLineup(teamSuffix: string): TeamInput['lineup'] {
  return Array.from({ length: 9 }, (_, i) => ({
    playerId: Number(`${teamSuffix}${i + 1}`),
    jerseyNo: i + 1,
    lastName: `Player${teamSuffix}_${i + 1}`,
    skills: { ag: randSkill(3, 8), avg: randSkill(3, 9), power: randSkill(2, 8), eye: randSkill(3, 8), dhr: randSkill(2, 8), speed: randSkill(2, 8) },
  }));
}

function makeBullpen(teamSuffix: string): TeamInput['bullpen'] {
  return Array.from({ length: 5 }, (_, i) => ({
    playerId: Number(`${teamSuffix}${10 + i}`),
    jerseyNo: 10 + i,
    lastName: `Pitcher${teamSuffix}_${i}`,
    skills: { ag: randSkill(3, 8), avg: randSkill(4, 9), power: randSkill(3, 8), eye: randSkill(3, 8), dhr: randSkill(2, 7), speed: 2, stamina: 3 + Math.floor(Math.random() * 7), pitchIntel: 3 + Math.floor(Math.random() * 7) },
    isStarter: i === 0,
  }));
}

const visitor: TeamInput = { teamId: 1, teamName: 'Visitors', lineup: makeLineup('1'), bullpen: makeBullpen('1') };
const home: TeamInput = { teamId: 2, teamName: 'Home Team', lineup: makeLineup('2'), bullpen: makeBullpen('2') };

console.time('sim');
const result = simulateGame(visitor, home);
console.timeEnd('sim');

console.log(`Final: ${result.visitorRuns}-${result.homeRuns} in ${result.innings} innings`);
console.log(`Winner: Team ${result.winningTeamId}`);
console.log(`Events: ${result.events.length}`);

// Outcome distribution
const counts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
for (const e of result.events) counts[e.outcome as keyof typeof counts]++;
const total = result.events.length;
console.log(`1B: ${counts[1]} (${(counts[1]/total*100).toFixed(1)}%) | 2B: ${counts[2]} (${(counts[2]/total*100).toFixed(1)}%) | 3B: ${counts[3]} (${(counts[3]/total*100).toFixed(1)}%) | HR: ${counts[4]} (${(counts[4]/total*100).toFixed(1)}%) | BB: ${counts[5]} (${(counts[5]/total*100).toFixed(1)}%) | GO: ${counts[6]} (${(counts[6]/total*100).toFixed(1)}%) | K: ${counts[7]} (${(counts[7]/total*100).toFixed(1)}%)`);
