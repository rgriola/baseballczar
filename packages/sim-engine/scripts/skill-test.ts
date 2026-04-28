/**
 * ═══════════════════════════════════════════════════════════════════
 * SKILL SENSITIVITY HARNESS  (Phase 7)
 * ═══════════════════════════════════════════════════════════════════
 *
 * Proves that skills actually matter in the sandbox. If a 9-power
 * lineup doesn't out-homer a 1-power lineup, no rate-stat tuning is
 * worth anything.
 *
 * Tests:
 *   1. all-9 vs all-1     → all-9 should win >95% of games
 *   2. power 1..9         → HR rate should rise monotonically
 *   3. eye 1..9           → BB% should rise monotonically
 *   4. pitchIntel 1..9    → opponent K% should rise monotonically
 *   5. speed 1..9         → infield singles should rise; XBH on OF hits
 *   6. defense 1..9       → BABIP-against should fall
 *
 * Run:  npx tsx scripts/skill-test.ts [--games 30]
 */
import { generateTeam, simulateGame, createRng } from '../src';
import type { Team, Player, Skills, GameResult, Rng } from '../src';

// ─── CLI args ──────────────────────────────────────────────────
const args = process.argv.slice(2);
function getArg(name: string, def: number): number {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return def;
  return parseInt(args[i + 1] ?? '', 10) || def;
}
const GAMES_PER_TEST = getArg('games', 30);

// ─── Helpers: build teams with controlled skills ──────────────
function setAllSkills(team: Team, override: Partial<Skills>): Team {
  for (const p of team.roster) {
    Object.assign(p.skills, override);
  }
  return team;
}

/** All position players + pitchers get the same skill values (1-10). */
function uniformSkillTeam(rng: Rng, name: string, value: number): Team {
  const t = generateTeam(rng, 1, name, name.slice(0, 3).toUpperCase());
  const all: Skills = {
    ag: value, avg: value, power: value, eye: value, dhr: value,
    speed: value, stamina: value, pitchIntel: value, defense: value,
  };
  // Pitchers: keep avg/power/eye/dhr at 1 (they don't hit in v1)
  for (const p of t.roster) {
    if (p.position === 'P') {
      p.skills = { ...all, avg: 1, power: 1, eye: 1, dhr: 1 };
    } else {
      p.skills = { ...all, stamina: 1, pitchIntel: 1 };
    }
  }
  return t;
}

/** Average team (all skills = 5) with one skill set to `value` for all hitters. */
function hitterSkillTeam(rng: Rng, name: string, skill: keyof Skills, value: number): Team {
  const t = uniformSkillTeam(rng, name, 5);
  for (const p of t.roster) {
    if (p.position !== 'P') {
      p.skills[skill] = value;
    }
  }
  return t;
}

/** Average team with one pitcher/defense skill varied. */
function pitcherSkillTeam(rng: Rng, name: string, skill: keyof Skills, value: number): Team {
  const t = uniformSkillTeam(rng, name, 5);
  for (const p of t.roster) {
    if (p.position === 'P') {
      p.skills[skill] = value;
    }
  }
  return t;
}

/** Defense skill needs to be applied to all fielders (not pitchers). */
function defenseSkillTeam(rng: Rng, name: string, value: number): Team {
  const t = uniformSkillTeam(rng, name, 5);
  for (const p of t.roster) {
    if (p.position !== 'P') {
      p.skills.defense = value;
    }
  }
  return t;
}

// ─── Series runner ─────────────────────────────────────────────
interface SeriesStats {
  wins: number;        // for "subject" team
  losses: number;
  runsFor: number;
  runsAgainst: number;
  // Subject-team batting totals
  paFor: number;
  hitsFor: number;
  hrFor: number;
  doublesFor: number;
  triplesFor: number;
  bbFor: number;
  kFor: number;
  babipDenomFor: number;  // PA - BB - K - HR
  babipNumFor: number;    // hits - HR
  // Subject-team pitching totals (allowed by them)
  paAgainst: number;
  hitsAgainst: number;
  bbAgainst: number;
  kAgainst: number;
  hrAgainst: number;
  babipDenomAgainst: number;
  babipNumAgainst: number;
  // Phase-5 outcomes
  hbpFor: number;            // subject batters hit by pitch
  hbpAgainst: number;        // subject pitchers hit opposing batters
  errorsCommitted: number;   // subject defense miscues (opp reached-on-error)
  errorsReceived: number;    // subject batters reach on opp's error
  dpsTurned: number;         // subject defense turns DPs
  dpsGroundedInto: number;   // subject batters ground into DPs
  sfHit: number;             // subject batters lift sac flies
  fcFor: number;             // subject batter reaches on FC
  fcAgainst: number;         // subject defense forces FC
}

function emptySeries(): SeriesStats {
  return {
    wins: 0, losses: 0, runsFor: 0, runsAgainst: 0,
    paFor: 0, hitsFor: 0, hrFor: 0, doublesFor: 0, triplesFor: 0,
    bbFor: 0, kFor: 0, babipDenomFor: 0, babipNumFor: 0,
    paAgainst: 0, hitsAgainst: 0, bbAgainst: 0, kAgainst: 0, hrAgainst: 0,
    babipDenomAgainst: 0, babipNumAgainst: 0,
    hbpFor: 0, hbpAgainst: 0,
    errorsCommitted: 0, errorsReceived: 0,
    dpsTurned: 0, dpsGroundedInto: 0,
    sfHit: 0, fcFor: 0, fcAgainst: 0,
  };
}

function isHit(r: string): boolean {
  return r === 'single' || r === 'double' || r === 'triple' || r === 'home-run';
}

function tally(g: GameResult, subjectIsHome: boolean, s: SeriesStats): void {
  const subjectRuns = subjectIsHome ? g.homeRuns : g.awayRuns;
  const oppRuns = subjectIsHome ? g.awayRuns : g.homeRuns;
  s.runsFor += subjectRuns;
  s.runsAgainst += oppRuns;
  if (subjectRuns > oppRuns) s.wins++;
  else if (subjectRuns < oppRuns) s.losses++;

  const subjectTeamId = subjectIsHome ? g.homeTeam.id : g.awayTeam.id;
  for (const ab of g.atBats) {
    const battingForSubject = (ab.half === 'top' && !subjectIsHome)
      || (ab.half === 'bottom' && subjectIsHome);
    const target = battingForSubject ? 'for' : 'against';
    const r = ab.result;
    if (target === 'for') {
      s.paFor++;
      if (r === 'walk') s.bbFor++;
      else if (r === 'strikeout') s.kFor++;
      else if (r === 'home-run') { s.hrFor++; s.hitsFor++; }
      else if (r === 'double') { s.doublesFor++; s.hitsFor++; }
      else if (r === 'triple') { s.triplesFor++; s.hitsFor++; }
      else if (r === 'single') s.hitsFor++;
      else if (r === 'hbp') s.hbpFor++;
      else if (r === 'reached-on-error') s.errorsReceived++;
      else if (r === 'double-play') s.dpsGroundedInto++;
      else if (r === 'fielders-choice') s.fcFor++;
      else if (r === 'sac-fly') s.sfHit++;
      // BABIP: hits-HR over balls in play (PA - BB - K - HR)
      if (r !== 'walk' && r !== 'strikeout' && r !== 'home-run' && r !== 'hbp') {
        s.babipDenomFor++;
        if (isHit(r) && r !== 'home-run') s.babipNumFor++;
      }
    } else {
      s.paAgainst++;
      if (r === 'walk') s.bbAgainst++;
      else if (r === 'strikeout') s.kAgainst++;
      else if (r === 'home-run') { s.hrAgainst++; s.hitsAgainst++; }
      else if (r === 'double' || r === 'triple' || r === 'single') s.hitsAgainst++;
      else if (r === 'hbp') s.hbpAgainst++;
      else if (r === 'reached-on-error') s.errorsCommitted++;
      else if (r === 'double-play') s.dpsTurned++;
      else if (r === 'fielders-choice') s.fcAgainst++;
      if (r !== 'walk' && r !== 'strikeout' && r !== 'home-run' && r !== 'hbp') {
        s.babipDenomAgainst++;
        if (isHit(r) && r !== 'home-run') s.babipNumAgainst++;
      }
    }
  }
  // Touch unused id to avoid lint
  void subjectTeamId;
}

function runSeries(
  buildSubject: (rng: Rng) => Team,
  buildOpponent: (rng: Rng) => Team,
  games: number,
  baseSeed: number,
): SeriesStats {
  const stats = emptySeries();
  for (let i = 0; i < games; i++) {
    const rng = createRng(baseSeed + i * 1009);
    const subject = buildSubject(rng);
    const opponent = buildOpponent(rng);
    // Alternate home/away to remove home-field bias
    const subjectIsHome = i % 2 === 0;
    const home = subjectIsHome ? subject : opponent;
    const away = subjectIsHome ? opponent : subject;
    home.id = 1; away.id = 2;
    const g = simulateGame(home, away, rng);
    tally(g, subjectIsHome, stats);
  }
  return stats;
}

// ─── Test reporters ────────────────────────────────────────────
function pct(n: number, d: number): string {
  if (d === 0) return ' .000';
  return (n / d).toFixed(3);
}
function fmt(n: number): string {
  return n.toFixed(2).padStart(6);
}

function header(title: string): void {
  console.log('\n' + '═'.repeat(72));
  console.log(' ' + title);
  console.log('═'.repeat(72));
}

// ─── Test 1: All-9 vs All-1 ────────────────────────────────────
function test1_AllNineVsAllOne(): void {
  header('TEST 1: All-9 lineup vs All-1 lineup');
  const stats = runSeries(
    (rng) => uniformSkillTeam(rng, 'Nines', 9),
    (rng) => uniformSkillTeam(rng, 'Ones', 1),
    GAMES_PER_TEST,
    1000,
  );
  const winPct = stats.wins / (stats.wins + stats.losses);
  console.log(`Record:  ${stats.wins}-${stats.losses}  (.${(winPct * 1000).toFixed(0).padStart(3, '0')})`);
  console.log(`Runs:    ${(stats.runsFor / GAMES_PER_TEST).toFixed(2)} for / ${(stats.runsAgainst / GAMES_PER_TEST).toFixed(2)} against per game`);
  const verdict = winPct >= 0.95 ? '✓ PASS  (skills dominate)' : '✗ FAIL  (skills not differentiating)';
  console.log(`Verdict: ${verdict}`);
}

// ─── Test 2: Sweep one hitter skill ────────────────────────────
function sweepHitterSkill(skill: keyof Skills, label: string, expectedRising: keyof SeriesStats): void {
  header(`TEST: ${label} skill 1 → 9 (vs avg=5 opponent)`);
  console.log('skill |   wins  | runs/g  | BB/PA  |  K/PA  | HR/PA  | XBH/PA | BABIP');
  console.log('──────┼─────────┼─────────┼────────┼────────┼────────┼────────┼──────');

  const values: (string | number)[][] = [];
  for (const v of [1, 3, 5, 7, 9]) {
    const stats = runSeries(
      (rng) => hitterSkillTeam(rng, `S${v}`, skill, v),
      (rng) => uniformSkillTeam(rng, 'Avg', 5),
      GAMES_PER_TEST,
      2000 + v * 17,
    );
    const xbh = stats.doublesFor + stats.triplesFor + stats.hrFor;
    const row = [
      v,
      `${stats.wins}-${stats.losses}`,
      (stats.runsFor / GAMES_PER_TEST).toFixed(2),
      pct(stats.bbFor, stats.paFor),
      pct(stats.kFor, stats.paFor),
      pct(stats.hrFor, stats.paFor),
      pct(xbh, stats.paFor),
      pct(stats.babipNumFor, stats.babipDenomFor),
    ];
    values.push(row);
    console.log(`  ${String(v).padStart(2)}  | ${row[1].toString().padStart(7)} | ${row[2].toString().padStart(7)} |  ${row[3]} |  ${row[4]} |  ${row[5]} |  ${row[6]} | ${row[7]}`);
  }

  // Monotonicity check on the expected-rising stat
  const series = values.map((r) => parseFloat(r[expectedRising as unknown as number] as string));
  let monotonic = true;
  for (let i = 1; i < series.length; i++) {
    if (series[i] < series[i - 1] - 0.005) { monotonic = false; break; }
  }
  console.log(`Monotonicity (${expectedRising}): ${monotonic ? '✓ PASS' : '✗ FAIL'}`);
  void fmt;  // suppress unused
}

// ─── Test 3: Sweep one pitcher skill ───────────────────────────
function sweepPitcherSkill(skill: keyof Skills, label: string): void {
  header(`TEST: pitcher ${label} skill 1 → 9 (vs avg=5 opponent)`);
  console.log('skill |   record  |  K%-against  |  BB%-against  |  BABIP-against');
  console.log('──────┼───────────┼──────────────┼───────────────┼────────────────');

  const ks: number[] = [];
  for (const v of [1, 3, 5, 7, 9]) {
    const stats = runSeries(
      (rng) => pitcherSkillTeam(rng, `P${v}`, skill, v),
      (rng) => uniformSkillTeam(rng, 'Avg', 5),
      GAMES_PER_TEST,
      3000 + v * 23,
    );
    const kPct = stats.kAgainst / Math.max(1, stats.paAgainst);
    const bbPct = stats.bbAgainst / Math.max(1, stats.paAgainst);
    const babip = stats.babipNumAgainst / Math.max(1, stats.babipDenomAgainst);
    ks.push(kPct);
    console.log(`  ${String(v).padStart(2)}  | ${`${stats.wins}-${stats.losses}`.padStart(9)} |     ${kPct.toFixed(3)}    |     ${bbPct.toFixed(3)}     |     ${babip.toFixed(3)}`);
  }
  let mono = true;
  for (let i = 1; i < ks.length; i++) if (ks[i] < ks[i - 1] - 0.005) { mono = false; break; }
  console.log(`Monotonicity (K%-against rising): ${mono ? '✓ PASS' : '✗ FAIL'}`);
}

// ─── Test 4: Sweep defense ─────────────────────────────────────
function sweepDefense(): void {
  header('TEST: defense skill 1 → 9 (fielders only)');
  console.log('skill |   record  | BABIP-against | runs-against/g');
  console.log('──────┼───────────┼───────────────┼────────────────');
  const babips: number[] = [];
  for (const v of [1, 3, 5, 7, 9]) {
    const stats = runSeries(
      (rng) => defenseSkillTeam(rng, `D${v}`, v),
      (rng) => uniformSkillTeam(rng, 'Avg', 5),
      GAMES_PER_TEST,
      4000 + v * 29,
    );
    const babip = stats.babipNumAgainst / Math.max(1, stats.babipDenomAgainst);
    babips.push(babip);
    console.log(`  ${String(v).padStart(2)}  | ${`${stats.wins}-${stats.losses}`.padStart(9)} |     ${babip.toFixed(3)}     |     ${(stats.runsAgainst / GAMES_PER_TEST).toFixed(2)}`);
  }
  let mono = true;
  for (let i = 1; i < babips.length; i++) if (babips[i] > babips[i - 1] + 0.005) { mono = false; break; }
  console.log(`Monotonicity (BABIP-against falling): ${mono ? '✓ PASS' : '✗ FAIL'}`);
}

// ─── Test 5 (Phase 7c): Phase-5 outcome leverage ──────────

function sweepPitcherHbp(): void {
  header('TEST: pitcher pitchIntel 1 → 9  (HBP-against should fall)');
  console.log('skill | HBP-against/g | walks-against/g');
  console.log('──────┼───────────────┼────────────────');
  const hbps: number[] = [];
  for (const v of [1, 3, 5, 7, 9]) {
    const stats = runSeries(
      (rng) => pitcherSkillTeam(rng, `P${v}`, 'pitchIntel', v),
      (rng) => uniformSkillTeam(rng, 'Avg', 5),
      GAMES_PER_TEST,
      5000 + v * 31,
    );
    const hbpPg = stats.hbpAgainst / GAMES_PER_TEST;
    hbps.push(hbpPg);
    console.log(`  ${String(v).padStart(2)}  |     ${hbpPg.toFixed(2)}      |      ${(stats.bbAgainst / GAMES_PER_TEST).toFixed(2)}`);
  }
  let mono = true;
  for (let i = 1; i < hbps.length; i++) if (hbps[i] > hbps[i - 1] + 0.10) { mono = false; break; }
  console.log(`Monotonicity (HBP-against falling): ${mono ? '✓ PASS' : '✗ FAIL  (noisy — small sample)'}`);
}

function sweepDefenseErrorsAndDP(): void {
  header('TEST: defense skill 1 → 9  (errors fall, DPs rise)');
  console.log('skill | errors/g (committed) | DPs/g (turned)');
  console.log('──────┼───────────────────────┼───────────────');
  const errs: number[] = [];
  const dps: number[] = [];
  for (const v of [1, 3, 5, 7, 9]) {
    const stats = runSeries(
      (rng) => defenseSkillTeam(rng, `D${v}`, v),
      (rng) => uniformSkillTeam(rng, 'Avg', 5),
      GAMES_PER_TEST,
      6000 + v * 37,
    );
    const ePg = stats.errorsCommitted / GAMES_PER_TEST;
    const dPg = stats.dpsTurned / GAMES_PER_TEST;
    errs.push(ePg); dps.push(dPg);
    console.log(`  ${String(v).padStart(2)}  |        ${ePg.toFixed(2)}          |     ${dPg.toFixed(2)}`);
  }
  let monoErr = true;
  for (let i = 1; i < errs.length; i++) if (errs[i] > errs[i - 1] + 0.10) { monoErr = false; break; }
  let monoDp = true;
  for (let i = 1; i < dps.length; i++) if (dps[i] < dps[i - 1] - 0.10) { monoDp = false; break; }
  console.log(`Monotonicity (errors falling): ${monoErr ? '✓ PASS' : '✗ FAIL'}`);
  console.log(`Monotonicity (DPs rising):     ${monoDp ? '✓ PASS' : '✗ FAIL'}`);
}

// ─── Main ──────────────────────────────────────────────────────
function main(): void {
  console.log(`skill-test: ${GAMES_PER_TEST} games per data point\n`);
  setAllSkills;  // suppress unused

  test1_AllNineVsAllOne();
  // For hitter sweeps, expectedRising is the column index in our row array (5 = HR/PA, 3 = BB/PA, etc.)
  // hitter row layout: [v, record, runs, BB%, K%, HR%, XBH%, BABIP]
  //                     0    1      2    3    4    5    6     7
  sweepHitterSkill('power', 'POWER',  6 as unknown as keyof SeriesStats);  // XBH/PA rising
  sweepHitterSkill('eye',   'EYE',    3 as unknown as keyof SeriesStats);  // BB/PA rising
  sweepHitterSkill('avg',   'AVG',    7 as unknown as keyof SeriesStats);  // BABIP rising (more contact)
  sweepHitterSkill('speed', 'SPEED',  7 as unknown as keyof SeriesStats);  // BABIP rising (beat-out singles)

  sweepPitcherSkill('pitchIntel', 'pitchIntel');
  sweepDefense();

  // Phase 7c: Phase-5 outcome leverage
  sweepPitcherHbp();
  sweepDefenseErrorsAndDP();
}

main();
