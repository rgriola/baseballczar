// Last touched by agent: 2026-05-06T13:21:29Z
/**
 * Full game simulation. 9 innings (extras up to maxInnings), runner
 * advancement on hits, manager pulls pitcher when needed.
 */
import type {
  Player, Team, GameResult, AtBatRecord, AtBatResult,
  PitcherGameStats, BatterGameStats, FielderGameStats,
} from './types';
import type { Position } from './config';
import { CONFIG } from './config';
import { simulateAtBat } from './atBat';
import { shouldPullPitcher, pickReliever, type ManagerState } from './manager';
import { isInfieldFly } from './rules/infieldFly';
import { classifySituationalOut } from './rules/situationalOuts';
import { resolveBaseAdvance } from './rules/advance';
import { decideRunnerAdvance } from './defense/decide';
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
  fielderStats: Map<number, FielderGameStats>;
  defenseMap: Map<Position, Player>;
}

function newPitcherStats(id: number): PitcherGameStats {
  return { pitcherId: id, battersFaced: 0, pitches: 0, outs: 0, hits: 0,
    runs: 0, earnedRuns: 0, walks: 0, strikeouts: 0, homeRuns: 0,
    putouts: 0, assists: 0, errors: 0, totalMph: 0 };
}
function newBatterStats(id: number): BatterGameStats {
  return { batterId: id, pa: 0, ab: 0, hits: 0, doubles: 0, triples: 0,
    homeRuns: 0, walks: 0, strikeouts: 0, runs: 0, rbis: 0, sb: 0, cs: 0,
    putouts: 0, assists: 0, errors: 0,
    battedBalls: 0, totalEV: 0, totalLA: 0, totalSpray: 0, totalBatSpeed: 0 };
}

function newFielderStats(id: number, position: Position): FielderGameStats {
  return { playerId: id, position, putouts: 0, assists: 0, errors: 0 };
}

/**
 * Apply PO/A/E credits from an at-bat to the team's fielder stat map.
 * Looks up the live defender at each credited position via `defenseMap`.
 */
function recordFieldingCredits(
  credits: NonNullable<AtBatRecord['fielding']>,
  defenseMap: Map<Position, Player>,
  fielderStats: Map<number, FielderGameStats>,
): void {
  const bump = (pos: Position, field: 'putouts' | 'assists' | 'errors') => {
    const player = defenseMap.get(pos);
    if (!player) return;
    let s = fielderStats.get(player.id);
    if (!s) {
      s = newFielderStats(player.id, pos);
      fielderStats.set(player.id, s);
    }
    s[field]++;
  };
  if (credits.putoutBy) bump(credits.putoutBy, 'putouts');
  if (credits.extraPutouts) for (const p of credits.extraPutouts) bump(p, 'putouts');
  if (credits.assistBy) for (const p of credits.assistBy) bump(p, 'assists');
  if (credits.errorBy) bump(credits.errorBy, 'errors');
}

function buildDefenseMap(team: Team, pitcher: Player): Map<Position, Player> {
  const map = new Map<Position, Player>();
  for (const p of team.lineup) {
    if (p.position !== 'P') map.set(p.position, p);
  }
  map.set('P', pitcher);
  return map;
}

function initTeamState(team: Team, starterIndex = 0): TeamGameState {
  const idx = starterIndex % team.rotation.length;
  const sp = team.rotation[idx];
  return {
    team,
    battingOrderIdx: 0,
    runs: 0,
    lineup: team.lineup,
    currentPitcher: sp,
    pitcherState: {
      pitcherId: sp.id, pitchCount: 0, battersFaced: 0,
      runsAllowed: 0, hitsAllowed: 0,
      isStarter: true, bullpenUsed: new Set(),
    },
    pitcherStats: new Map([[sp.id, newPitcherStats(sp.id)]]),
    batterStats: new Map(team.roster.map(p => [p.id, newBatterStats(p.id)])),
    fielderStats: new Map(),
    defenseMap: buildDefenseMap(team, sp),
  };
}

/** Advance baserunners on a hit. Returns runs scored. */
// (Legacy `advanceRunners` removed in Phase A refactor; logic now
//  lives in `rules/advance.ts` so the visualizer (events/baseRunning)
//  walks the exact same trips the engine resolved.)

function isOut(result: AtBatResult): boolean {
  return ['strikeout', 'ground-out', 'fly-out', 'line-out',
          'pop-out', 'foul-out', 'double-play',
          'fielders-choice', 'sac-fly'].includes(result);
}

function isHit(result: AtBatResult): boolean {
  return ['single', 'double', 'triple', 'home-run', 'base-hit'].includes(result);
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
  const next = pickReliever(state.team, state.pitcherState.bullpenUsed, inning, scoreDiff);
  if (!next) return;
  state.pitcherState.bullpenUsed.add(next.id);
  state.currentPitcher = next;
  state.pitcherState = {
    pitcherId: next.id, pitchCount: 0, battersFaced: 0,
    runsAllowed: 0, hitsAllowed: 0,
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
  opts?: GameOptions,
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

    // ─── Infield Fly Rule ───────────────────────────────────────
    // Must run BEFORE situational reclassification: an IFR call
    // makes the batter automatically out and freezes runners,
    // regardless of how the converger / hit classifier resolved
    // the ball. Prevents the cheap drop-DP exploit.
    if (isInfieldFly({ outs, bases, battedBall: ab.battedBall })) {
      ab.result = 'pop-out';
      // Force the fielding credit to the converger (or P as a
      // fallback) so the box score reflects who would've caught it.
      ab.fielding = { putoutBy: ab.fieldedBy ?? 'P' };
    }

    // ─── Phase 5: situational reclassification (DP / FC / sac-fly) ─
    const fielder = ab.fieldedBy ? fielding.defenseMap.get(ab.fieldedBy) : undefined;
    const fielderDef = fielder?.skills.fielding ?? 5;
    const fielderThrowing = fielder?.skills.throwing ?? 5;
    ab.result = classifySituationalOut(ab.result, {
      outs, bases,
      fieldedBy: ab.fieldedBy,
      fielderDefense: fielderDef,
      defenseLeadDeficit: fielding.runs - batting.runs,
      runnerOn3: bases[2] ?? undefined,
      flyBallDepthFt: ab.battedBall?.distanceFt,
      fielderThrowing,
    }, rng);

    // ─── Resolve runner advance (single source of truth) ─────────
    // For 'base-hit' results, invoke the resolvePlay callback (tick-engine)
    // to simulate the play dynamically and determine the actual outcome.
    if (ab.result === 'base-hit' && opts?.resolvePlay) {
      const resolved = opts.resolvePlay(ab, fielding.defenseMap, bases, rng);
      ab.result = resolved.outcome;
      // Use the tick-engine's resolved runner positions
      const resolvedBases: (Player | null)[] = [null, null, null];
      for (const rState of resolved.runnersAfter) {
        const baseIdx = rState.base === 'first' ? 0 : rState.base === 'second' ? 1 : 2;
        // Find the player by id from the current context
        const player = rState.runnerId === batter.id
          ? batter
          : bases.find(b => b?.id === rState.runnerId) ?? null;
        resolvedBases[baseIdx] = player;
      }
      bases = resolvedBases;
      outs += resolved.outsRecorded;
      const runsThisPa = resolved.runsScored;
      batting.runs += runsThisPa;
      ab.runsScored = runsThisPa;
      ab.rbis = runsThisPa;
      for (const scorerId of resolved.scoredRunnerIds) {
        const bs = batting.batterStats.get(scorerId);
        if (bs) bs.runs++;
      }
    } else {
      // Non-base-hit or no resolver: use the existing deterministic
      // advance logic (walks, outs, infield singles, HRs, etc.)
      // Phase 4 PI gate: r1→3rd on a single is the runner's read.
      let r1HoldsAtSecond = false;
      const r1OnBase = bases[0];
      if (ab.result === 'single' && r1OnBase) {
        const goes = decideRunnerAdvance('r1-to-3rd-single', r1OnBase, rng, {
          sprayAngleDeg: ab.battedBall?.sprayAngleDeg,
        });
        r1HoldsAtSecond = !goes;
        ab.runnerAdvances = { r1OnSingle: goes ? 'third' : 'second' };
      }
      const adv = resolveBaseAdvance(bases, batter, ab.result, {
        errorType: ab.errorType,
        r1HoldsAtSecond,
        outsBefore: outs,
      });
      bases = adv.newBases;
      outs += adv.outsRecorded;
      const runsThisPa = adv.runsScored;
      batting.runs += runsThisPa;
      ab.runsScored = runsThisPa;
      ab.rbis = runsThisPa;
      for (const sc of adv.scorers) {
        const bs = batting.batterStats.get(sc.id);
        if (bs) bs.runs++;
      }
    }

    const batterStats = batting.batterStats.get(batter.id);
    if (batterStats) {
      const scoredSelf = ab.result === 'home-run';
      recordBatterStat(batterStats, ab, ab.runsScored, scoredSelf);
    }
    const pitcherStats = fielding.pitcherStats.get(fielding.currentPitcher.id);
    if (pitcherStats) recordPitcherStat(pitcherStats, ab, ab.runsScored);

    // Track performance in manager state for shelling detection
    fielding.pitcherState.runsAllowed += ab.runsScored;
    if (isHit(ab.result)) fielding.pitcherState.hitsAllowed++;

    // Fielding credits (PO/A/E) — pulled from ab.fielding which atBat.ts
    // populates from (result, fieldedBy) using standard scorekeeping.
    if (ab.fielding) {
      recordFieldingCredits(ab.fielding, fielding.defenseMap, fielding.fielderStats);
    }

    atBats.push(ab);

    if (outs < 3) {
      maybeChangePitcher(fielding, inning, fielding.runs - batting.runs);
    }
  }
}

export interface ResolvePlayResult {
  outcome: AtBatResult;
  outsRecorded: number;
  runsScored: number;
  runnersAfter: { runnerId: number; base: 'first' | 'second' | 'third' }[];
  scoredRunnerIds: number[];
}

export type ResolvePlayFn = (
  ab: AtBatRecord,
  defenseMap: Map<Position, Player>,
  bases: readonly (Player | null)[],
  rng: Rng,
) => ResolvePlayResult;

export interface GameOptions {
  /** Index into each team's rotation array. Default 0. */
  homeStarterIndex?: number;
  awayStarterIndex?: number;
  /** Tick-engine resolver callback. When provided, outfield hits
   *  ('base-hit') are simulated through the tick-engine for dynamic
   *  runner advancement. Without this, base-hits fall through to
   *  the default single-like advance. */
  resolvePlay?: ResolvePlayFn;
}

/**
 * @deprecated Use `simulateFullGame()` from `@baseballczar/tick-engine` instead.
 * This game loop lacks tick-engine physics (fielding AI, throw decisions, real baserunning).
 * Retained only for `season.ts` batch benchmarking. Will be removed in a future phase.
 */
export function simulateGame(home: Team, away: Team, rng: Rng, opts?: GameOptions): GameResult {
  const homeState = initTeamState(home, opts?.homeStarterIndex ?? 0);
  const awayState = initTeamState(away, opts?.awayStarterIndex ?? 0);
  const atBats: AtBatRecord[] = [];

  let inning = 1;
  while (inning <= CONFIG.game.maxInnings) {
    simulateHalfInning(awayState, homeState, inning, 'top', atBats, rng, opts);
    if (inning >= 9 && homeState.runs > awayState.runs) break;  // walk-off skip
    simulateHalfInning(homeState, awayState, inning, 'bottom', atBats, rng, opts);
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
  const fielderStats = new Map<number, FielderGameStats>();
  for (const [k, v] of homeState.fielderStats) fielderStats.set(k, v);
  for (const [k, v] of awayState.fielderStats) fielderStats.set(k, v);

  return {
    homeTeam: home,
    awayTeam: away,
    homeRuns: homeState.runs,
    awayRuns: awayState.runs,
    innings: inning,
    atBats,
    pitcherStats,
    batterStats,
    fielderStats,
  };
}
