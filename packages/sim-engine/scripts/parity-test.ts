import { createRng, generateMatchup, simulateGame, buildEvents } from '../src';

let mismatches = 0;
const N = 200;
for (let seed = 1; seed <= N; seed++) {
  const rng = createRng(seed);
  const { home, away } = generateMatchup(rng);
  const g = simulateGame(home, away, rng);
  const events = buildEvents(g);
  let h = 0, a = 0;
  for (const e of events) {
    if (e.type === 'run-scored') {
      if (e.battingTeamId === g.homeTeam.id) h++;
      else a++;
    }
  }
  if (h !== g.homeRuns || a !== g.awayRuns) {
    mismatches++;
    if (mismatches <= 5) console.log(`seed ${seed}: events=${a}-${h}  result=${g.awayRuns}-${g.homeRuns}`);
  }
}
console.log(`${N - mismatches}/${N} games match (${((1 - mismatches/N) * 100).toFixed(1)}%)`);
