/**
 * Aggregate rate stats across multiple games and compare to expected
 * MLB ranges from CONFIG.expectedRanges. Used by the CLI runner and
 * by unit tests as a regression detector.
 */
import type { GameResult } from './types';
import { CONFIG } from './config';

export interface RateReport {
  games: number;
  totalPa: number;
  totalAb: number;
  totalPitches: number;
  totalFouls: number;
  totalContact: number;
  totalHits: number;
  totalSingles: number;
  totalDoubles: number;
  totalTriples: number;
  totalHr: number;
  totalBb: number;
  totalK: number;
  totalRuns: number;
  totalFlyBalls: number;

  bbPct: number;
  kPct: number;
  babip: number;
  hrPerFb: number;
  pitchesPerPa: number;
  pitchesPerGame: number;       // per team
  runsPerGame: number;          // per team
  foulsPerPa: number;
  hPerGame: number;             // per team
  doublesPerGame: number;
  triplesPerGame: number;
  hrPerGame: number;

  expectations: Record<string, { value: number; range: readonly [number, number]; pass: boolean }>;
}

export function aggregate(games: GameResult[]): RateReport {
  let pa = 0, ab = 0, pitches = 0, fouls = 0, contact = 0;
  let hits = 0, singles = 0, doubles = 0, triples = 0, hr = 0;
  let bb = 0, k = 0, runs = 0, flyBalls = 0;
  let hbp = 0, errors = 0, dps = 0, fcs = 0, sfs = 0;

  for (const g of games) {
    runs += g.homeRuns + g.awayRuns;
    for (const at of g.atBats) {
      pa++;
      if (!['walk', 'hbp', 'sac-fly'].includes(at.result)) ab++;
      pitches += at.pitches.length;
      for (const p of at.pitches) {
        if (p.outcome === 'foul') fouls++;
        if (p.outcome === 'foul' || p.outcome === 'in-play') contact++;
      }
      switch (at.result) {
        case 'single': hits++; singles++; break;
        case 'double': hits++; doubles++; break;
        case 'triple': hits++; triples++; break;
        case 'home-run': hits++; hr++; break;
        case 'walk': bb++; break;
        case 'hbp': hbp++; break;
        case 'strikeout': k++; break;
        case 'reached-on-error': errors++; break;
        case 'double-play': dps++; break;
        case 'fielders-choice': fcs++; break;
        case 'sac-fly': sfs++; flyBalls++; break;
        case 'fly-out':
        case 'pop-out':
          flyBalls++;
          break;
      }
      if (at.result === 'home-run') flyBalls++;
    }
  }

  const teamGames = games.length * 2;
  const ballsInPlay = ab - k - hr;
  const r: RateReport & { totalHbp: number; totalErrors: number; totalDp: number; totalFc: number; totalSf: number } = {
    games: games.length,
    totalPa: pa, totalAb: ab, totalPitches: pitches, totalFouls: fouls,
    totalContact: contact, totalHits: hits, totalSingles: singles,
    totalDoubles: doubles, totalTriples: triples, totalHr: hr,
    totalBb: bb, totalK: k, totalRuns: runs, totalFlyBalls: flyBalls,
    totalHbp: hbp, totalErrors: errors, totalDp: dps, totalFc: fcs, totalSf: sfs,

    bbPct: bb / Math.max(1, pa),
    kPct: k / Math.max(1, pa),
    babip: (hits - hr) / Math.max(1, ballsInPlay),
    hrPerFb: hr / Math.max(1, flyBalls),
    pitchesPerPa: pitches / Math.max(1, pa),
    pitchesPerGame: pitches / Math.max(1, teamGames),
    runsPerGame: runs / Math.max(1, teamGames),
    foulsPerPa: fouls / Math.max(1, pa),
    hPerGame: hits / Math.max(1, teamGames),
    doublesPerGame: doubles / Math.max(1, teamGames),
    triplesPerGame: triples / Math.max(1, teamGames),
    hrPerGame: hr / Math.max(1, teamGames),
    expectations: {},
  };

  const E = CONFIG.expectedRanges;
  const check = (name: string, value: number, range: readonly [number, number]) => {
    r.expectations[name] = { value, range, pass: value >= range[0] && value <= range[1] };
  };
  check('bbPct',         r.bbPct,         E.bbPct);
  check('kPct',          r.kPct,          E.kPct);
  check('babip',         r.babip,         E.babip);
  check('hrPerFb',       r.hrPerFb,       E.hrPerFb);
  check('pitchesPerPa',  r.pitchesPerPa,  E.pitchesPerPa);
  check('pitchesPerGame',r.pitchesPerGame,E.pitchesPerGame);
  check('runsPerGame',   r.runsPerGame,   E.runsPerGame);
  check('foulsPerPa',    r.foulsPerPa,    E.foulsPerPa);
  return r;
}

export function formatReport(r: RateReport): string {
  const lines: string[] = [];
  lines.push(`Games: ${r.games}   PA: ${r.totalPa}   Pitches: ${r.totalPitches}`);
  lines.push('');
  lines.push('Rate                   value    expected range    ');
  lines.push('─'.repeat(60));
  for (const [name, ex] of Object.entries(r.expectations)) {
    const v = ex.value.toFixed(3);
    const rng = `[${ex.range[0]}, ${ex.range[1]}]`;
    const tag = ex.pass ? '  ok ' : ' FAIL';
    lines.push(`${name.padEnd(20)} ${v.padStart(8)}   ${rng.padEnd(18)} ${tag}`);
  }
  lines.push('');
  lines.push('Per-team-game:');
  lines.push(`  R: ${r.runsPerGame.toFixed(2)}   H: ${r.hPerGame.toFixed(2)}   ` +
    `2B: ${r.doublesPerGame.toFixed(2)}   3B: ${r.triplesPerGame.toFixed(2)}   ` +
    `HR: ${r.hrPerGame.toFixed(2)}`);
  // Phase 5 outcomes (cast for added counters)
  const ext = r as RateReport & { totalHbp?: number; totalErrors?: number; totalDp?: number; totalFc?: number; totalSf?: number };
  if (ext.totalHbp !== undefined) {
    const tg = r.games * 2;
    lines.push('Phase-5 outcomes (per team-game):');
    lines.push(`  HBP: ${(ext.totalHbp! / tg).toFixed(2)}   E: ${(ext.totalErrors! / tg).toFixed(2)}   ` +
      `DP: ${(ext.totalDp! / tg).toFixed(2)}   FC: ${(ext.totalFc! / tg).toFixed(2)}   ` +
      `SF: ${(ext.totalSf! / tg).toFixed(2)}`);
  }
  return lines.join('\n');
}
