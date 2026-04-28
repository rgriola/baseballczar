/**
 * Full game simulation. 9 innings (extras up to maxInnings), runner
 * advancement on hits, manager pulls pitcher when needed.
 */
import type {
  Player, Team, GameResult, AtBatRecord, AtBatResult,
  PitcherGameStats, BatterGameStats,
} from './types';
import type { Position } from './config';
import { CONFIG } from './config';
import { simulateAtBat } from './atBat';
import { shouldPullPitcher, pickReliever, type ManagerState } from './manager';
import type { Rng } from './rng';

interface TeamGameState {
  team: Team;
  battingOrderIdx: number;
  runs: number;
  lineup: Player[];
  currentPitcher: Player;
  pitcherState: ManagerState;
  pitcherStats: Map<number, PitcherGameStats>;
  batterStats: Map<number, BatterGameStats>;
  defenseMap: Map<Position, Player>;
}

function newPitcherStats(id: number): PitcherGameStats {
  return { pitcherId: id, battersFaced: 0, pitches: 0, outs: 0, hits: 0,
    runs: 0, earnedRuns: 0, walks: 0, strikeouts: 0, homeRuns: 0 };
}
function newBatterStats(id: number): BatterGameStats {
  return { batterId: id, pa: 0, ab: 0, hits: 0, doubles: 0, triples: 0,
    homeRuns: 0, walks: 0, strikeouts: 0, runs: 0, rbis: 0 };
}

function buildDefenseMap(team: Team, pitcher: Player): Map<Position, Player> {
  const map = new Map<Position, Player>();
  for (const p of team.lineup) {
    if (p.position !== 'P') map.set(p.position, p);
  }
  map.set('P', pitcher);
  return map;
}

function initTeamState(team: Team): TeamGameState {
  const sp = team.rotation[0];
  return {
    team,
    battingOrderIdx: 0,
    runs: 0,
    lineup: team.lineup,
    currentPitcher: sp,
    pitcherState: {
      pitcherId: sp.id, pitchCount: 0, battersFaced: 0,
      isStarter: true, bullpenUsed: new Set(),
    },
    pitcherStats: new Map([[sp.id, newPitcherStats(sp.id)]]),
    batterStats: new Map(team.roster.map(p => [p.id, newBatterStats(p.id)])),
    defenseMap: buildDefenseMap(team, sp),
  };
}

/** Advance baserunners on a hit. Returns runs scored. */
function advanceRunners(
  bases: (Player | null)[],   // [1B, 2B, 3B] runners
  batter: Player,
  result: AtBatResult,
): { newBases: (Player | null)[]; runsScored: number; scorers: Player[] } {
  const [r1, r2, r3] = bases;
  const scorers: Player[] = [];
  let nb: (Player | null)[] = [null, null, null];
  switch (result) {
    case 'walk':
    case 'hbp':
    case 'walk':
    case 'hbp':
    case 'reached-on-error': {
      // Force advances only if next base is occupied. Runners not forced
      // hold their bag — start nb as a copy of bases so untouched runners
      // are preserved (fixes a bug where r3 was dropped on a walk with
      // [r1, _, r3]).
      nb = [r1, r2, r3];
      let push: Player | null = batter;
      let i = 0;
      while (push && i < 3) {
        const occupant = bases[i];
        nb[i] = push;
        push = occupant;
        if (!occupant) { push = null; break; }
        i++;
      }
      // Anyone forced past 3B scores
      if (push) scorers.push(push);
      break;
    }
    case 'single': {
      nb = [batter, r1, null];
      if (r2) scorers.push(r2);
      if (r3) scorers.push(r3);
      // r1 advances to 3B (assume runner-on-1st hold-up)
      nb[2] = r1 ?? null;
      nb[1] = null;
      // Re-place: batter on 1B, r1 → 3B, r2/r3 score
      nb = [batter, null, r1 ?? null];
      if (r2) scorers.push(r2);  // already pushed above; dedupe below
      break;
    }
    case 'double': {
      nb = [null, batter, r1 ?? null];
      if (r2) scorers.push(r2);
      if (r3) scorers.push(r3);
      break;
    }
    case 'triple': {
      nb = [null, null, batter];
      if (r1) scorers.push(r1);
      if (r2) scorers.push(r2);
      if (r3) scorers.push(r3);
      break;
    }
    case 'home-run': {
      scorers.push(batter);
      if (r1) scorers.push(r1);
      if (r2) scorers.push(r2);
      if (r3) scorers.push(r3);
      break;
    }
    default:
      // Outs handled by caller — just keep bases as-is
      nb = [r1, r2, r3];
  }
  // Dedupe scorers (single double-pushed r2 above)
  const unique: Player[] = [];
  for (const p of scorers) if (!unique.includes(p)) unique.push(p);
  return { newBases: nb, runsScored: unique.length, scorers: unique };
}

function isOut(result: AtBatResult): boolean {
  return ['strikeout', 'ground-out', 'fly-out', 'line-out',
          'pop-out', 'foul-out', 'double-play',
          'fielders-choice', 'sac-fly'].includes(result);
}

function isHit(result: AtBatResult): boolean {
  return ['single', 'double', 'triple', 'home-run'].includes(result);
}

function recordPitcherStat(
  s: PitcherGameStats, ab: AtBatRecord, runsThisPa: number,
): void {
  s.battersFaced++;
  s.pitches += ab.pitches.length;
  if (isOut(ab.result)) s.outs += ab.result === 'double-play' ? 2 : 1;
  if (isHit(ab.result)) s.hits++;
  if (ab.result === 'home-run') s.homeRuns++;
  if (ab.result === 'walk' || ab.result === 'hbp') s.walks++;
  if (ab.result === 'strikeout') s.strikeouts++;
  s.runs += runsThisPa;
  s.earnedRuns += runsThisPa;   // v1: all runs earned
}

function recordBatterStat(s: BatterGameStats, ab: AtBatRecord, runsThisPa: number, scoredSelf: boolean): void {
  s.pa++;
  if (ab.result !== 'walk' && ab.result !== 'hbp' && ab.result !== 'sac-fly') s.ab++;
  if (isHit(ab.result)) s.hits++;
  if (ab.result === 'double') s.doubles++;
  if (ab.result === 'triple') s.triples++;
  if (ab.result === 'home-run') s.homeRuns++;
  if (ab.result === 'walk') s.walks++;
  if (ab.result === 'strikeout') s.strikeouts++;
  if (scoredSelf) s.runs++;
  s.rbis += runsThisPa;
}

function maybeChangePitcher(
  state: TeamGameState, inning: number, scoreDiff: number,
): void {
  if (!shouldPullPitcher(state.pitcherState, state.team, inning, scoreDiff)) return;
  const next = pickReliever(state.team, state.pitcherState.bullpenUsed);
  if (!next) return;
  state.pitcherState.bullpenUsed.add(next.id);
  state.currentPitcher = next;
  state.pitcherState = {
    pitcherId: next.id, pitchCount: 0, battersFaced: 0,
    isStarter: false, bullpenUsed: state.pitcherState.bullpenUsed,
  };
  state.pitcherStats.set(next.id, newPitcherStats(next.id));
  state.defenseMap.set('P', next);
}

function simulateHalfInning(
  batting: TeamGameState,
  fielding: TeamGameState,
  inning: number,
  half: 'top' | 'bottom',
  atBats: AtBatRecord[],
  rng: Rng,
): void {
  let outs = 0;
  let bases: (Player | null)[] = [null, null, null];

  while (outs < 3) {
    const batter = batting.lineup[batting.battingOrderIdx % batting.lineup.length];
    batting.battingOrderIdx++;

    const ab = simulateAtBat(batter, fielding.currentPitcher, {
      inning, half, outs,
      defense: fielding.defenseMap,
      pitcherPitchCount: fielding.pitcherState.pitchCount,
    }, rng);

    fielding.pitcherState.pitchCount += ab.pitches.length;
    fielding.pitcherState.battersFaced++;

    // ─── Phase 5: situational reclassification ──────────────────
    // Convert generic ground-out / fly-out into DP, FC, or sac-fly
    // based on base state and outs.
    const runnerOn1 = bases[0] !== null;
    const runnerOn3 = bases[2] !== null;
    const fielderDef = ab.fieldedBy
      ? fielding.defenseMap.get(ab.fieldedBy)?.skills.defense ?? 5
      : 5;

    if (ab.result === 'ground-out' && runnerOn1 && outs < 2) {
      // DPs realistically only on grounders to MIF or 3B (6-4-3, 4-6-3, 5-4-3).
      const dpFeasible = ab.fieldedBy === 'SS' || ab.fieldedBy === 'B2' || ab.fieldedBy === 'B3';
      const dpProb = dpFeasible
        ? CONFIG.doublePlay.baseProb + (fielderDef - 5) * CONFIG.doublePlay.skillLeverage
        : 0;
      if (rng.bool(Math.max(0, Math.min(0.85, dpProb)))) {
        ab.result = 'double-play';
      } else if (rng.bool(CONFIG.baserunning.fcProb)) {
        // Fielder's choice: lead runner out, batter safe at 1B
        ab.result = 'fielders-choice';
      }
    } else if (ab.result === 'fly-out' && runnerOn3 && outs < 2) {
      // Sac fly: must be OF fly (not infield popup)
      const isOFfly = ab.fieldedBy === 'LF' || ab.fieldedBy === 'CF' || ab.fieldedBy === 'RF';
      if (isOFfly && rng.bool(CONFIG.baserunning.sacFlyTagProb)) {
        ab.result = 'sac-fly';
      }
    }

    let runsThisPa = 0;
    if (isOut(ab.result)) {
      outs += ab.result === 'double-play' ? 2 : 1;
      // Apply special-case base/run effects for situational outs
      if (ab.result === 'double-play') {
        // Lead runner (on 1B) and batter both out; runners on 2B/3B advance one
        bases = [null, bases[0], bases[1]];
      } else if (ab.result === 'fielders-choice') {
        // Lead runner (on 1B) out; batter takes 1B; other runners advance
        bases = [batter, null, bases[1]];
      } else if (ab.result === 'sac-fly') {
        // Runner on 3B scores; runner on 2B may advance to 3B
        runsThisPa = 1;
        batting.runs++;
        const scorer = bases[2]!;
        const scs = batting.batterStats.get(scorer.id);
        if (scs) scs.runs++;
        bases = [bases[0], null, bases[1]];
        ab.runsScored = 1;
        ab.rbis = 1;
      }
    } else {
      const adv = advanceRunners(bases, batter, ab.result);
      bases = adv.newBases;
      runsThisPa = adv.runsScored;
      batting.runs += runsThisPa;
      ab.runsScored = runsThisPa;
      ab.rbis = ab.result === 'home-run' || ab.result === 'sac-fly'
        ? runsThisPa
        : runsThisPa;
      // Record runs-scored stat for each scorer
      for (const sc of adv.scorers) {
        const bs = batting.batterStats.get(sc.id);
        if (bs) bs.runs++;
      }
    }
    const batterStats = batting.batterStats.get(batter.id);
    if (batterStats) {
      const scoredSelf = ab.result === 'home-run';
      recordBatterStat(batterStats, ab, runsThisPa, scoredSelf);
    }
    const pitcherStats = fielding.pitcherStats.get(fielding.currentPitcher.id);
    if (pitcherStats) recordPitcherStat(pitcherStats, ab, runsThisPa);

    atBats.push(ab);

    if (outs < 3) {
      maybeChangePitcher(fielding, inning, fielding.runs - batting.runs);
    }
  }
}

export function simulateGame(home: Team, away: Team, rng: Rng): GameResult {
  const homeState = initTeamState(home);
  const awayState = initTeamState(away);
  const atBats: AtBatRecord[] = [];

  let inning = 1;
  while (inning <= CONFIG.game.maxInnings) {
    simulateHalfInning(awayState, homeState, inning, 'top', atBats, rng);
    if (inning >= 9 && homeState.runs > awayState.runs) break;  // walk-off skip
    simulateHalfInning(homeState, awayState, inning, 'bottom', atBats, rng);
    if (inning >= 9 && homeState.runs !== awayState.runs) break;
    inning++;
  }

  // Merge stats across pitchers (in case both teams used same id — shouldn't happen)
  const pitcherStats = new Map<number, PitcherGameStats>();
  for (const [k, v] of homeState.pitcherStats) pitcherStats.set(k, v);
  for (const [k, v] of awayState.pitcherStats) pitcherStats.set(k, v);
  const batterStats = new Map<number, BatterGameStats>();
  for (const [k, v] of homeState.batterStats) batterStats.set(k, v);
  for (const [k, v] of awayState.batterStats) batterStats.set(k, v);

  return {
    homeTeam: home,
    awayTeam: away,
    homeRuns: homeState.runs,
    awayRuns: awayState.runs,
    innings: inning,
    atBats,
    pitcherStats,
    batterStats,
  };
}
