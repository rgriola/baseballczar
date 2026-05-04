/**
 * Season Orchestrator — Simulates a full baseball season.
 *
 * Creates N teams with persistent rosters, generates a round-robin
 * schedule, simulates every game, and accumulates standings + player
 * stats across the entire season.
 *
 * Usage:
 *   npx tsx scripts/sim-season.ts [--teams 8] [--games 162] [--seed 42]
 */
import type { Player, Team, GameResult, BatterGameStats, PitcherGameStats } from './types';
import { generateTeam } from './randomTeam';
import { simulateGame, type GameOptions } from './game';
import { createRng, type Rng } from './rng';

// ─── Team names ──────────────────────────────────────────────────
const TEAM_NAMES: { name: string; abbrev: string }[] = [
  { name: 'Eagles',     abbrev: 'EGL' },
  { name: 'Wolves',     abbrev: 'WLV' },
  { name: 'Sharks',     abbrev: 'SHK' },
  { name: 'Falcons',    abbrev: 'FLC' },
  { name: 'Titans',     abbrev: 'TTN' },
  { name: 'Vipers',     abbrev: 'VPR' },
  { name: 'Stallions',  abbrev: 'STL' },
  { name: 'Panthers',   abbrev: 'PNT' },
  { name: 'Grizzlies',  abbrev: 'GRZ' },
  { name: 'Hawks',      abbrev: 'HWK' },
  { name: 'Blazers',    abbrev: 'BLZ' },
  { name: 'Mustangs',   abbrev: 'MST' },
  { name: 'Raptors',    abbrev: 'RPT' },
  { name: 'Cobras',     abbrev: 'CBR' },
  { name: 'Thunder',    abbrev: 'THD' },
  { name: 'Hurricanes', abbrev: 'HRC' },
];

// ─── Types ───────────────────────────────────────────────────────

export interface SeasonConfig {
  /** Number of teams (2–16). Default 8. */
  numTeams: number;
  /** Games per team (each opponent played equally). Default 162. */
  gamesPerTeam: number;
  /** RNG seed for reproducibility. */
  seed: number;
}

export interface TeamRecord {
  team: Team;
  wins: number;
  losses: number;
  runsScored: number;
  runsAllowed: number;
  /** Game results for this team (all games, in order). */
  gameLog: GameLogEntry[];
}

export interface GameLogEntry {
  gameNum: number;
  opponent: string;
  home: boolean;
  runsFor: number;
  runsAgainst: number;
  win: boolean;
}

export interface SeasonBatterStats {
  player: Player;
  teamAbbrev: string;
  games: number;
  pa: number;
  ab: number;
  hits: number;
  doubles: number;
  triples: number;
  homeRuns: number;
  rbis: number;
  runs: number;
  walks: number;
  strikeouts: number;
}

export interface SeasonPitcherStats {
  player: Player;
  teamAbbrev: string;
  games: number;
  battersFaced: number;
  pitches: number;
  outs: number;
  hits: number;
  runs: number;
  earnedRuns: number;
  walks: number;
  strikeouts: number;
  homeRuns: number;
}

export interface SeasonResult {
  config: SeasonConfig;
  standings: TeamRecord[];
  /** Top batters by PA (min 100 PA). */
  batterLeaders: SeasonBatterStats[];
  /** Top pitchers by outs (min 50 outs). */
  pitcherLeaders: SeasonPitcherStats[];
  totalGames: number;
  elapsedMs: number;
}

// ─── Schedule generation ─────────────────────────────────────────

interface ScheduledGame {
  homeIdx: number;
  awayIdx: number;
}

/**
 * Generate a balanced schedule where each team plays `gamesPerTeam` games,
 * split as evenly as possible among opponents.
 */
function generateSchedule(numTeams: number, gamesPerTeam: number, rng: Rng): ScheduledGame[] {
  const pairings: ScheduledGame[] = [];
  const opponents = numTeams - 1;
  const seriesPerOpponent = Math.ceil(gamesPerTeam / opponents);

  // Build round-robin series
  for (let series = 0; series < seriesPerOpponent; series++) {
    for (let i = 0; i < numTeams; i++) {
      for (let j = i + 1; j < numTeams; j++) {
        // Alternate home/away each series
        if (series % 2 === 0) {
          pairings.push({ homeIdx: i, awayIdx: j });
        } else {
          pairings.push({ homeIdx: j, awayIdx: i });
        }
      }
    }
  }

  // Shuffle for variety
  for (let i = pairings.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [pairings[i], pairings[j]] = [pairings[j], pairings[i]];
  }

  // Trim to target total (gamesPerTeam * numTeams / 2)
  const totalGames = Math.floor(gamesPerTeam * numTeams / 2);
  return pairings.slice(0, totalGames);
}

// ─── Stat accumulation ───────────────────────────────────────────

function accumulateBatterStats(
  season: Map<number, SeasonBatterStats>,
  gameStats: Map<number, BatterGameStats>,
  roster: Player[],
  teamAbbrev: string,
): void {
  for (const [playerId, gs] of gameStats) {
    let ss = season.get(playerId);
    if (!ss) {
      const player = roster.find(p => p.id === playerId);
      if (!player) continue;
      ss = {
        player, teamAbbrev, games: 0,
        pa: 0, ab: 0, hits: 0, doubles: 0, triples: 0,
        homeRuns: 0, rbis: 0, runs: 0, walks: 0, strikeouts: 0,
      };
      season.set(playerId, ss);
    }
    ss.games++;
    ss.pa += gs.pa;
    ss.ab += gs.ab;
    ss.hits += gs.hits;
    ss.doubles += gs.doubles;
    ss.triples += gs.triples;
    ss.homeRuns += gs.homeRuns;
    ss.rbis += gs.rbis;
    ss.runs += gs.runs;
    ss.walks += gs.walks;
    ss.strikeouts += gs.strikeouts;
  }
}

function accumulatePitcherStats(
  season: Map<number, SeasonPitcherStats>,
  gameStats: Map<number, PitcherGameStats>,
  roster: Player[],
  teamAbbrev: string,
): void {
  for (const [playerId, gs] of gameStats) {
    let ss = season.get(playerId);
    if (!ss) {
      const player = roster.find(p => p.id === playerId);
      if (!player) continue;
      ss = {
        player, teamAbbrev, games: 0,
        battersFaced: 0, pitches: 0, outs: 0, hits: 0,
        runs: 0, earnedRuns: 0, walks: 0, strikeouts: 0, homeRuns: 0,
      };
      season.set(playerId, ss);
    }
    ss.games++;
    ss.battersFaced += gs.battersFaced;
    ss.pitches += gs.pitches;
    ss.outs += gs.outs;
    ss.hits += gs.hits;
    ss.runs += gs.runs;
    ss.earnedRuns += gs.earnedRuns;
    ss.walks += gs.walks;
    ss.strikeouts += gs.strikeouts;
    ss.homeRuns += gs.homeRuns;
  }
}

// ─── Format helpers ──────────────────────────────────────────────

function avg(hits: number, ab: number): string {
  if (ab === 0) return '.000';
  return (hits / ab).toFixed(3).replace(/^0/, '');
}

function era(earnedRuns: number, outs: number): string {
  if (outs === 0) return '-.--';
  return ((earnedRuns * 27) / outs).toFixed(2);
}

function ip(outs: number): string {
  const full = Math.floor(outs / 3);
  const partial = outs % 3;
  return partial === 0 ? `${full}.0` : `${full}.${partial}`;
}

function pct(wins: number, losses: number): string {
  if (wins + losses === 0) return '.000';
  return (wins / (wins + losses)).toFixed(3).replace(/^0/, '');
}

function gb(topWins: number, topLosses: number, w: number, l: number): string {
  const diff = ((topWins - w) + (l - topLosses)) / 2;
  if (diff === 0) return '  -';
  return diff.toFixed(1).padStart(4);
}

// ─── Main simulation ─────────────────────────────────────────────

export function simulateSeason(config: SeasonConfig): SeasonResult {
  const t0 = Date.now();
  const rng = createRng(config.seed);
  const numTeams = Math.max(2, Math.min(16, config.numTeams));

  // Generate persistent teams
  const teams: Team[] = [];
  for (let i = 0; i < numTeams; i++) {
    const { name, abbrev } = TEAM_NAMES[i % TEAM_NAMES.length];
    teams.push(generateTeam(rng, i + 1, name, abbrev));
  }

  // Initialize standings
  const records: TeamRecord[] = teams.map(team => ({
    team, wins: 0, losses: 0, runsScored: 0, runsAllowed: 0, gameLog: [],
  }));

  // Season-long stat accumulators
  const seasonBatters = new Map<number, SeasonBatterStats>();
  const seasonPitchers = new Map<number, SeasonPitcherStats>();

  // Generate schedule
  const schedule = generateSchedule(numTeams, config.gamesPerTeam, rng);

  // Track rotation index per team (cycles 0→1→2→3→4→0→...)
  const rotationIdx = new Array(numTeams).fill(0);

  // Simulate every game
  for (let gi = 0; gi < schedule.length; gi++) {
    const { homeIdx, awayIdx } = schedule[gi];
    const homeTeam = teams[homeIdx];
    const awayTeam = teams[awayIdx];

    // Each game gets its own RNG branch for reproducibility
    const gameRng = createRng(config.seed + gi * 7919 + homeIdx * 31 + awayIdx);

    // Cycle through the 5-man rotation
    const gameOpts: GameOptions = {
      homeStarterIndex: rotationIdx[homeIdx],
      awayStarterIndex: rotationIdx[awayIdx],
    };
    const result: GameResult = simulateGame(homeTeam, awayTeam, gameRng, gameOpts);

    // Advance rotation
    rotationIdx[homeIdx] = (rotationIdx[homeIdx] + 1) % homeTeam.rotation.length;
    rotationIdx[awayIdx] = (rotationIdx[awayIdx] + 1) % awayTeam.rotation.length;

    // Update standings
    const homeWon = result.homeRuns > result.awayRuns;
    const homeRec = records[homeIdx];
    const awayRec = records[awayIdx];

    if (homeWon) { homeRec.wins++; awayRec.losses++; }
    else         { homeRec.losses++; awayRec.wins++; }

    homeRec.runsScored += result.homeRuns;
    homeRec.runsAllowed += result.awayRuns;
    awayRec.runsScored += result.awayRuns;
    awayRec.runsAllowed += result.homeRuns;

    homeRec.gameLog.push({
      gameNum: gi + 1, opponent: awayTeam.abbrev, home: true,
      runsFor: result.homeRuns, runsAgainst: result.awayRuns, win: homeWon,
    });
    awayRec.gameLog.push({
      gameNum: gi + 1, opponent: homeTeam.abbrev, home: false,
      runsFor: result.awayRuns, runsAgainst: result.homeRuns, win: !homeWon,
    });

    // Accumulate player stats
    accumulateBatterStats(seasonBatters, result.batterStats, homeTeam.roster, homeTeam.abbrev);
    accumulateBatterStats(seasonBatters, result.batterStats, awayTeam.roster, awayTeam.abbrev);
    accumulatePitcherStats(seasonPitchers, result.pitcherStats, homeTeam.roster, homeTeam.abbrev);
    accumulatePitcherStats(seasonPitchers, result.pitcherStats, awayTeam.roster, awayTeam.abbrev);
  }

  // Sort standings by win%
  records.sort((a, b) => {
    const wpctA = a.wins / Math.max(1, a.wins + a.losses);
    const wpctB = b.wins / Math.max(1, b.wins + b.losses);
    return wpctB - wpctA;
  });

  // Build batter leaders (min 100 PA, sorted by AVG)
  const batterLeaders = [...seasonBatters.values()]
    .filter(s => s.pa >= 100)
    .sort((a, b) => (b.hits / Math.max(1, b.ab)) - (a.hits / Math.max(1, a.ab)));

  // Build pitcher leaders (min 50 outs, sorted by ERA)
  const pitcherLeaders = [...seasonPitchers.values()]
    .filter(s => s.outs >= 50)
    .sort((a, b) =>
      (a.earnedRuns * 27 / Math.max(1, a.outs)) -
      (b.earnedRuns * 27 / Math.max(1, b.outs))
    );

  return {
    config,
    standings: records,
    batterLeaders,
    pitcherLeaders,
    totalGames: schedule.length,
    elapsedMs: Date.now() - t0,
  };
}

// ─── Text output ─────────────────────────────────────────────────

export function formatSeasonReport(result: SeasonResult): string {
  const lines: string[] = [];
  const { config, standings, batterLeaders, pitcherLeaders } = result;

  lines.push('╔══════════════════════════════════════════════════════════════╗');
  lines.push(`║  SEASON REPORT — ${config.numTeams} teams, ${config.gamesPerTeam} games/team, seed ${config.seed}`);
  lines.push(`║  ${result.totalGames} total games simulated in ${(result.elapsedMs / 1000).toFixed(1)}s`);
  lines.push('╚══════════════════════════════════════════════════════════════╝');
  lines.push('');

  // ── Standings ──
  lines.push('┌──────────────────────────────────────────────────────────┐');
  lines.push('│  STANDINGS                                               │');
  lines.push('├──────────────────────────────────────────────────────────┤');
  lines.push('│  #   Team           W     L    PCT     GB    RS    RA   │');
  lines.push('├──────────────────────────────────────────────────────────┤');

  const topW = standings[0]?.wins ?? 0;
  const topL = standings[0]?.losses ?? 0;

  for (let i = 0; i < standings.length; i++) {
    const r = standings[i];
    const rank = String(i + 1).padStart(2);
    const name = r.team.name.padEnd(14);
    const w = String(r.wins).padStart(4);
    const l = String(r.losses).padStart(4);
    const wpct = pct(r.wins, r.losses).padStart(6);
    const gbStr = gb(topW, topL, r.wins, r.losses);
    const rs = String(r.runsScored).padStart(5);
    const ra = String(r.runsAllowed).padStart(5);
    lines.push(`│  ${rank}  ${name}${w}  ${l}  ${wpct}  ${gbStr}  ${rs}  ${ra}   │`);
  }
  lines.push('└──────────────────────────────────────────────────────────┘');
  lines.push('');

  // ── Batting Leaders (top 15) ──
  lines.push('┌─────────────────────────────────────────────────────────────────────────────┐');
  lines.push('│  BATTING LEADERS (min 100 PA)                                              │');
  lines.push('├─────────────────────────────────────────────────────────────────────────────┤');
  lines.push('│  #   Player               Team   G   PA   AVG    H  2B  3B  HR  RBI   BB  │');
  lines.push('├─────────────────────────────────────────────────────────────────────────────┤');

  const topBatters = batterLeaders.slice(0, 15);
  for (let i = 0; i < topBatters.length; i++) {
    const s = topBatters[i];
    const rank = String(i + 1).padStart(2);
    const pName = `${s.player.firstName[0]}. ${s.player.lastName}`.padEnd(20);
    const team = s.teamAbbrev.padEnd(4);
    const g = String(s.games).padStart(4);
    const pa = String(s.pa).padStart(4);
    const ba = avg(s.hits, s.ab).padStart(6);
    const h = String(s.hits).padStart(4);
    const d = String(s.doubles).padStart(3);
    const t = String(s.triples).padStart(3);
    const hr = String(s.homeRuns).padStart(3);
    const rbi = String(s.rbis).padStart(4);
    const bb = String(s.walks).padStart(4);
    lines.push(`│  ${rank}  ${pName} ${team} ${g} ${pa} ${ba}  ${h} ${d} ${t} ${hr} ${rbi}  ${bb}  │`);
  }
  lines.push('└─────────────────────────────────────────────────────────────────────────────┘');
  lines.push('');

  // ── HR Leaders (top 10) ──
  const hrLeaders = [...batterLeaders].sort((a, b) => b.homeRuns - a.homeRuns).slice(0, 10);
  lines.push('┌──────────────────────────────────────────────┐');
  lines.push('│  HOME RUN LEADERS                            │');
  lines.push('├──────────────────────────────────────────────┤');
  for (const s of hrLeaders) {
    const pName = `${s.player.firstName[0]}. ${s.player.lastName}`.padEnd(20);
    lines.push(`│  ${pName} ${s.teamAbbrev}   ${String(s.homeRuns).padStart(3)} HR  │`);
  }
  lines.push('└──────────────────────────────────────────────┘');
  lines.push('');

  // ── RBI Leaders (top 10) ──
  const rbiLeaders = [...batterLeaders].sort((a, b) => b.rbis - a.rbis).slice(0, 10);
  lines.push('┌──────────────────────────────────────────────┐');
  lines.push('│  RBI LEADERS                                 │');
  lines.push('├──────────────────────────────────────────────┤');
  for (const s of rbiLeaders) {
    const pName = `${s.player.firstName[0]}. ${s.player.lastName}`.padEnd(20);
    lines.push(`│  ${pName} ${s.teamAbbrev}   ${String(s.rbis).padStart(3)} RBI │`);
  }
  lines.push('└──────────────────────────────────────────────┘');
  lines.push('');

  // ── Pitching Leaders (top 10) ──
  lines.push('┌──────────────────────────────────────────────────────────────────────┐');
  lines.push('│  PITCHING LEADERS (min 50 outs)                                     │');
  lines.push('├──────────────────────────────────────────────────────────────────────┤');
  lines.push('│  #   Player               Team   G    IP    ERA    K    BB    HR    │');
  lines.push('├──────────────────────────────────────────────────────────────────────┤');

  const topPitchers = pitcherLeaders.slice(0, 10);
  for (let i = 0; i < topPitchers.length; i++) {
    const s = topPitchers[i];
    const rank = String(i + 1).padStart(2);
    const pName = `${s.player.firstName[0]}. ${s.player.lastName}`.padEnd(20);
    const team = s.teamAbbrev.padEnd(4);
    const g = String(s.games).padStart(4);
    const innings = ip(s.outs).padStart(6);
    const eraStr = era(s.earnedRuns, s.outs).padStart(6);
    const k = String(s.strikeouts).padStart(4);
    const bb = String(s.walks).padStart(5);
    const hr = String(s.homeRuns).padStart(5);
    lines.push(`│  ${rank}  ${pName} ${team} ${g} ${innings} ${eraStr}  ${k}  ${bb}  ${hr}    │`);
  }
  lines.push('└──────────────────────────────────────────────────────────────────────┘');
  lines.push('');

  // ── Strikeout Leaders (top 10) ──
  const kLeaders = [...pitcherLeaders].sort((a, b) => b.strikeouts - a.strikeouts).slice(0, 10);
  lines.push('┌──────────────────────────────────────────────┐');
  lines.push('│  STRIKEOUT LEADERS                           │');
  lines.push('├──────────────────────────────────────────────┤');
  for (const s of kLeaders) {
    const pName = `${s.player.firstName[0]}. ${s.player.lastName}`.padEnd(20);
    lines.push(`│  ${pName} ${s.teamAbbrev}   ${String(s.strikeouts).padStart(3)} K   │`);
  }
  lines.push('└──────────────────────────────────────────────┘');

  return lines.join('\n');
}
