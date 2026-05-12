/**
 * Box Score Generator — Produces a formatted box score from a GameResult.
 *
 * Outputs:
 *   - Linescore (runs per inning)
 *   - Batting lines (AB, R, H, 2B, 3B, HR, RBI, BB, SO)
 *   - Pitching lines (IP, H, R, ER, BB, SO, HR, PC)
 *   - Team totals
 */
import type { GameResult, AtBatRecord, BatterGameStats, PitcherGameStats, Team, Player } from './types';

// ─── Types ───────────────────────────────────────────────────────

export interface BoxScoreBatter {
  player: Player;
  orderNum: number;
  posLabel: string;
  ab: number;
  runs: number;
  hits: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  rbis: number;
  walks: number;
  strikeouts: number;
}

export interface BoxScorePitcher {
  player: Player;
  ip: string;       // "6.1" format
  ipOuts: number;    // raw outs for math
  hits: number;
  runs: number;
  earnedRuns: number;
  walks: number;
  strikeouts: number;
  homeRuns: number;
  pitches: number;
  decision?: 'W' | 'L' | 'SV';
}

export interface BoxScoreTeamLine {
  teamName: string;
  teamAbbrev: string;
  innings: number[];    // runs per inning
  totalRuns: number;
  totalHits: number;
  totalErrors: number;
  batters: BoxScoreBatter[];
  pitchers: BoxScorePitcher[];
}

export interface BoxScore {
  away: BoxScoreTeamLine;
  home: BoxScoreTeamLine;
  innings: number;
  gameResult: GameResult;
}

// ─── Helpers ─────────────────────────────────────────────────────

const POS_DISPLAY: Record<string, string> = {
  P: 'P', C: 'C', B1: '1B', B2: '2B', SS: 'SS', B3: '3B',
  LF: 'LF', CF: 'CF', RF: 'RF', DH: 'DH',
};

function formatIP(outs: number): string {
  const full = Math.floor(outs / 3);
  const partial = outs % 3;
  return partial === 0 ? `${full}.0` : `${full}.${partial}`;
}

// ─── Build Box Score ─────────────────────────────────────────────

export function buildBoxScore(result: GameResult): BoxScore {
  const { homeTeam, awayTeam, atBats } = result;
  const numInnings = result.innings;

  // Build runs-per-inning arrays
  const awayInnings = new Array(numInnings).fill(0);
  const homeInnings = new Array(numInnings).fill(0);

  for (const ab of atBats) {
    const inn = Math.min(ab.inning, numInnings) - 1;
    if (ab.half === 'top') {
      awayInnings[inn] += ab.runsScored;
    } else {
      homeInnings[inn] += ab.runsScored;
    }
  }

  // Build batter lines
  function buildBatters(team: Team, stats: Map<number, BatterGameStats>): BoxScoreBatter[] {
    return team.lineup.map((p, i) => {
      const s = stats.get(p.id);
      return {
        player: p,
        orderNum: i + 1,
        posLabel: POS_DISPLAY[p.position] ?? p.position,
        ab: s?.ab ?? 0,
        runs: s?.runs ?? 0,
        hits: s?.hits ?? 0,
        doubles: s?.doubles ?? 0,
        triples: s?.triples ?? 0,
        homeRuns: s?.homeRuns ?? 0,
        rbis: s?.rbis ?? 0,
        walks: s?.walks ?? 0,
        strikeouts: s?.strikeouts ?? 0,
      };
    });
  }

  // Build pitcher lines
  function buildPitchers(team: Team, stats: Map<number, PitcherGameStats>): BoxScorePitcher[] {
    const pitchers: BoxScorePitcher[] = [];

    // Start with the rotation[0] (starter), then add bullpen pitchers who appeared
    const starterIds = new Set(team.rotation.map(p => p.id));
    const bpIds = new Set(team.bullpen.map(p => p.id));

    // Find all pitchers who appeared in this game
    const appeared: { player: Player; stats: PitcherGameStats }[] = [];
    for (const [id, s] of stats) {
      if (s.battersFaced === 0) continue;
      const player = team.roster.find(p => p.id === id);
      if (!player) continue;
      appeared.push({ player, stats: s });
    }

    // Sort: starter first, then by appearance order (most outs = came in earlier)
    appeared.sort((a, b) => {
      const aIsStarter = starterIds.has(a.player.id) ? 0 : 1;
      const bIsStarter = starterIds.has(b.player.id) ? 0 : 1;
      if (aIsStarter !== bIsStarter) return aIsStarter - bIsStarter;
      return b.stats.outs - a.stats.outs; // most outs first (entered earlier)
    });

    for (const { player, stats: s } of appeared) {
      pitchers.push({
        player,
        ip: formatIP(s.outs),
        ipOuts: s.outs,
        hits: s.hits,
        runs: s.runs,
        earnedRuns: s.earnedRuns,
        walks: s.walks,
        strikeouts: s.strikeouts,
        homeRuns: s.homeRuns,
        pitches: s.pitches,
      });
    }

    return pitchers;
  }

  // Count total hits and errors
  function totalHits(batters: BoxScoreBatter[]): number {
    return batters.reduce((sum, b) => sum + b.hits, 0);
  }

  function totalErrors(team: Team): number {
    let e = 0;
    const stats = result.fielderStats;
    for (const p of team.roster) {
      const s = stats.get(p.id);
      if (s) e += s.errors;
    }
    return e;
  }

  const awayBatters = buildBatters(awayTeam, result.batterStats);
  const homeBatters = buildBatters(homeTeam, result.batterStats);
  const awayPitchers = buildPitchers(awayTeam, result.pitcherStats);
  const homePitchers = buildPitchers(homeTeam, result.pitcherStats);

  // Assign W/L/SV decisions
  const homeWon = result.homeRuns > result.awayRuns;
  const winPitchers = homeWon ? homePitchers : awayPitchers;
  const losePitchers = homeWon ? awayPitchers : homePitchers;

  // W: starter gets the win if they pitched 5+ innings (15 outs), else last reliever
  if (winPitchers.length > 0) {
    const starter = winPitchers[0];
    if (starter.ipOuts >= 15 || winPitchers.length === 1) {
      starter.decision = 'W';
    } else {
      // Last reliever before the final pitcher gets the W
      // (simplified — in real baseball it's the pitcher of record when the
      // winning team took the lead)
      const relieverIdx = Math.max(1, winPitchers.length - 2);
      winPitchers[relieverIdx].decision = 'W';
    }
  }

  // L: starter of losing team (simplified)
  if (losePitchers.length > 0) {
    losePitchers[0].decision = 'L';
  }

  // SV: last pitcher of winning team if different from W pitcher and pitched 3+ outs
  if (winPitchers.length > 1) {
    const closer = winPitchers[winPitchers.length - 1];
    if (!closer.decision && closer.ipOuts >= 3) {
      closer.decision = 'SV';
    }
  }

  return {
    away: {
      teamName: awayTeam.name,
      teamAbbrev: awayTeam.abbrev,
      innings: awayInnings,
      totalRuns: result.awayRuns,
      totalHits: totalHits(awayBatters),
      totalErrors: totalErrors(awayTeam),
      batters: awayBatters,
      pitchers: awayPitchers,
    },
    home: {
      teamName: homeTeam.name,
      teamAbbrev: homeTeam.abbrev,
      innings: homeInnings,
      totalRuns: result.homeRuns,
      totalHits: totalHits(homeBatters),
      totalErrors: totalErrors(homeTeam),
      batters: homeBatters,
      pitchers: homePitchers,
    },
    innings: numInnings,
    gameResult: result,
  };
}

// ─── Text formatter ──────────────────────────────────────────────

export function formatBoxScore(box: BoxScore): string {
  const lines: string[] = [];
  const { away, home, innings } = box;

  // ── Linescore ──
  const innHeaders = Array.from({ length: innings }, (_, i) => String(i + 1).padStart(3));
  lines.push(`           ${innHeaders.join('')}   R   H   E`);
  lines.push('  ─────────' + '───'.repeat(innings) + '──────────');

  const awayInn = away.innings.map(r => String(r).padStart(3));
  const homeInn = home.innings.map(r => String(r).padStart(3));
  lines.push(
    `  ${away.teamAbbrev.padEnd(6)}  ${awayInn.join('')}  ${String(away.totalRuns).padStart(2)}  ${String(away.totalHits).padStart(2)}  ${String(away.totalErrors).padStart(2)}`
  );
  lines.push(
    `  ${home.teamAbbrev.padEnd(6)}  ${homeInn.join('')}  ${String(home.totalRuns).padStart(2)}  ${String(home.totalHits).padStart(2)}  ${String(home.totalErrors).padStart(2)}`
  );
  lines.push('');

  // ── Batting ──
  function printBatting(teamLine: BoxScoreTeamLine): void {
    lines.push(`  ${teamLine.teamName} Batting`);
    lines.push('  ────────────────────────────────────────────────────────');
    lines.push('  #   Player               Pos   AB   R   H  2B  3B  HR  RBI  BB  SO');
    lines.push('  ────────────────────────────────────────────────────────');
    for (const b of teamLine.batters) {
      const num = String(b.orderNum).padStart(2);
      const name = `${b.player.firstName[0]}. ${b.player.lastName}`.padEnd(20);
      const pos = b.posLabel.padEnd(3);
      lines.push(
        `  ${num}  ${name} ${pos}  ${String(b.ab).padStart(3)}  ${String(b.runs).padStart(2)}  ${String(b.hits).padStart(2)}  ${String(b.doubles).padStart(2)}  ${String(b.triples).padStart(2)}  ${String(b.homeRuns).padStart(2)}  ${String(b.rbis).padStart(3)}  ${String(b.walks).padStart(2)}  ${String(b.strikeouts).padStart(2)}`
      );
    }
    // Team totals
    const totAB = teamLine.batters.reduce((s, b) => s + b.ab, 0);
    const totR = teamLine.totalRuns;
    const totH = teamLine.totalHits;
    const tot2B = teamLine.batters.reduce((s, b) => s + b.doubles, 0);
    const tot3B = teamLine.batters.reduce((s, b) => s + b.triples, 0);
    const totHR = teamLine.batters.reduce((s, b) => s + b.homeRuns, 0);
    const totRBI = teamLine.batters.reduce((s, b) => s + b.rbis, 0);
    const totBB = teamLine.batters.reduce((s, b) => s + b.walks, 0);
    const totSO = teamLine.batters.reduce((s, b) => s + b.strikeouts, 0);
    lines.push('  ────────────────────────────────────────────────────────');
    lines.push(
      `      ${'TOTAL'.padEnd(20)} ${'   '}  ${String(totAB).padStart(3)}  ${String(totR).padStart(2)}  ${String(totH).padStart(2)}  ${String(tot2B).padStart(2)}  ${String(tot3B).padStart(2)}  ${String(totHR).padStart(2)}  ${String(totRBI).padStart(3)}  ${String(totBB).padStart(2)}  ${String(totSO).padStart(2)}`
    );
    lines.push('');
  }

  printBatting(away);
  printBatting(home);

  // ── Pitching ──
  function printPitching(teamLine: BoxScoreTeamLine): void {
    lines.push(`  ${teamLine.teamName} Pitching`);
    lines.push('  ────────────────────────────────────────────────────────');
    lines.push('  Player                  IP    H   R  ER  BB  SO  HR   PC');
    lines.push('  ────────────────────────────────────────────────────────');
    for (const p of teamLine.pitchers) {
      const name = `${p.player.firstName[0]}. ${p.player.lastName}`.padEnd(22);
      lines.push(
        `  ${name} ${p.ip.padStart(4)}  ${String(p.hits).padStart(3)}  ${String(p.runs).padStart(2)}  ${String(p.earnedRuns).padStart(2)}  ${String(p.walks).padStart(2)}  ${String(p.strikeouts).padStart(2)}  ${String(p.homeRuns).padStart(2)}  ${String(p.pitches).padStart(3)}`
      );
    }
    lines.push('');
  }

  printPitching(away);
  printPitching(home);

  return lines.join('\n');
}
