/**
 * ═══════════════════════════════════════════════════════════════════
 * SIM-LAB EVENT LOG  (Phase 8.5)
 * ═══════════════════════════════════════════════════════════════════
 *
 * Translates a `GameResult` into a flat, ordered stream of `SimEvent`s
 * suitable for 2D playback (Phase 9), debugging, or persistence to a
 * Postgres `events JSONB` column.
 *
 * Design rules:
 *   • Pure derivation — no game logic lives here. We replay a finished
 *     `GameResult` and emit events in chronological order. Consumers
 *     can fully reconstruct the visual story without re-running the sim.
 *   • Each event is self-contained: a renderer never needs to look at
 *     the previous event to understand what's happening *now*.
 *   • Times are *relative offsets in seconds*. A renderer can pace
 *     them however it wants (real-time, 4×, scrub).
 *   • All field positions in feet, origin = home plate, +x = right of
 *     the catcher, +y = toward CF.
 *
 * Known limitations (v0):
 *   • Score parity ~94% across random seeds. Three edge cases (rare
 *     baserunner permutations) can drift by 1 run vs `GameResult`.
 *     A `console.warn` flags any mismatch. Will tighten before Phase 9.
 *   • Fielder/throw events use placeholder `playerId: -1` — renderer
 *     must resolve the active fielder via the most recent `inning-start`
 *     defense map.
 */
import type {
  GameResult, AtBatRecord, AtBatResult, Player, BattedBall,
} from './types';
import type { Position } from './config';
import { FIELDER_POSITIONS_FT } from './physics/positions';
import { BASE_COORDS_FT } from './physics/speed';

// ─── Time budgets (sim seconds) ────────────────────────────────
const TIME = {
  pitchToHomeSec: 0.45,        // ~95 mph fastball
  betweenPitchesSec: 12,       // batter steps out, pitcher gathers
  contactToFieldedDefault: 1.5,
  fieldedToThrowSec: 0.6,      // glove → release
  throwToBaseSec: 1.0,         // average infield throw
  betweenAtBatsSec: 25,
  betweenInningsSec: 120,  /** Reaction time between contact and a runner taking off. */
  runnerReactionSec: 0.4,
  /** Time to traverse one 90-ft segment (home→1B, 1B→2B, etc.). */
  perBaseSec: 3.5,} as const;

// ─── Event types ───────────────────────────────────────────────
export interface BaseEvent {
  seq: number;          // global sequence id within the game
  t: number;            // sim seconds since game start
}

export interface GameStartEvent extends BaseEvent {
  type: 'game-start';
  homeTeamId: number; homeTeamName: string;
  awayTeamId: number; awayTeamName: string;
}

export interface InningStartEvent extends BaseEvent {
  type: 'inning-start';
  inning: number; half: 'top' | 'bottom';
  battingTeamId: number; fieldingTeamId: number;
  defense: { position: Position; playerId: number; firstName: string; lastName: string }[];
}

export interface AtBatStartEvent extends BaseEvent {
  type: 'at-bat-start';
  inning: number; half: 'top' | 'bottom'; outs: number;
  batter: { id: number; firstName: string; lastName: string; hand: 'L' | 'R' | 'S' };
  pitcher: { id: number; firstName: string; lastName: string; hand: 'L' | 'R' };
  runners: (number | null)[];   // [1B, 2B, 3B] — playerIds or null
}

export interface PitchEvt extends BaseEvent {
  type: 'pitch';
  pitchNum: number; balls: number; strikes: number;
  intentZone: 'in' | 'edge' | 'off';
  actualInZone: boolean;
  swung: boolean;
  outcome: 'ball' | 'called-strike' | 'swinging-strike' | 'foul' | 'foul-out' | 'hbp' | 'in-play';
  flightSec: number;            // pitch travel time (fixed per type for now)
}

export interface ContactEvent extends BaseEvent {
  type: 'contact';
  exitVeloMph: number; launchAngleDeg: number; sprayAngleDeg: number;
  distanceFt: number; hangTimeSec: number;
  landingPoint: { x: number; y: number };
  isFoul: boolean; isHomeRun: boolean;
}

export interface FielderConvergeEvent extends BaseEvent {
  type: 'fielder-converge';
  position: Position; playerId: number;
  fromPoint: { x: number; y: number };
  toPoint: { x: number; y: number };
  reachSec: number;
}

export interface ThrowEvent extends BaseEvent {
  type: 'throw';
  fromPosition: Position; fromPlayerId: number;
  fromPoint: { x: number; y: number };
  toBase: 'first' | 'second' | 'third' | 'home';
  toPoint: { x: number; y: number };
  flightSec: number;
}

/**
 * Tells the renderer which fielder breaks to cover a base while a throw
 * is in the air. The cover fielder leaves their starting position and
 * arrives at the bag in `arriveSec` (timed so they reach the bag
 * fractionally before the ball does).
 */
export interface CoverBaseEvent extends BaseEvent {
  type: 'cover-base';
  position: Position;            // who is covering (e.g. B1)
  base: 'first' | 'second' | 'third' | 'home';
  fromPoint: { x: number; y: number };
  toPoint: { x: number; y: number };
  arriveSec: number;
}

export interface RunnerAdvanceEvent extends BaseEvent {
  type: 'runner-advance';
  runnerId: number;
  fromBase: 'home' | 'first' | 'second' | 'third';
  toBase: 'first' | 'second' | 'third' | 'home';
  travelSec: number;
}

export interface OutEvent extends BaseEvent {
  type: 'out';
  outNum: number;                // outs in inning AFTER this play (1, 2, or 3)
  reason: AtBatResult;
  atPosition?: Position;         // who recorded the out
  runnerId?: number;             // for force outs / DPs / FCs
}

export interface RunScoredEvent extends BaseEvent {
  type: 'run-scored';
  runnerId: number;
  battingTeamId: number;
  scoreHome: number; scoreAway: number;
}

export interface AtBatEndEvent extends BaseEvent {
  type: 'at-bat-end';
  result: AtBatResult;
  rbis: number; runsScored: number;
}

export interface InningEndEvent extends BaseEvent {
  type: 'inning-end';
  inning: number; half: 'top' | 'bottom';
  scoreHome: number; scoreAway: number;
}

export interface GameEndEvent extends BaseEvent {
  type: 'game-end';
  scoreHome: number; scoreAway: number; innings: number;
}

export type SimEvent =
  | GameStartEvent | InningStartEvent | AtBatStartEvent
  | PitchEvt | ContactEvent | FielderConvergeEvent | ThrowEvent | CoverBaseEvent
  | RunnerAdvanceEvent | OutEvent | RunScoredEvent
  | AtBatEndEvent | InningEndEvent | GameEndEvent;

/**
 * Discriminated-union-friendly form of `Omit<SimEvent, 'seq' | 't'>`.
 * `Omit<Union, K>` collapses the union and confuses TS literal narrowing;
 * this maps over each variant so the `type` discriminator still drives
 * which other keys are required/allowed.
 */
type SimEventInit = {
  [K in SimEvent['type']]: Omit<Extract<SimEvent, { type: K }>, 'seq' | 't'>;
}[SimEvent['type']];

// ─── Helpers ───────────────────────────────────────────────────
function isOut(r: AtBatResult): boolean {
  return ['strikeout', 'ground-out', 'fly-out', 'line-out',
          'pop-out', 'foul-out', 'double-play',
          'fielders-choice', 'sac-fly'].includes(r);
}

function basePoint(b: 'home' | 'first' | 'second' | 'third'): { x: number; y: number } {
  if (b === 'home') return { x: 0, y: 0 };
  return BASE_COORDS_FT[b];
}

/**
 * Walk the runner state forward for an at-bat, emitting `runner-advance`,
 * `out`, and `run-scored` events. Mutates `bases` in place. Returns the
 * post-AB outs count and the latest absolute timestamp at which any
 * runner finishes their advance (so the caller can keep the global clock
 * in sync before emitting `at-bat-end`).
 *
 * Timing model:
 *   • Runners react `runnerReactionSec` after contact, then move at
 *     `perBaseSec` per 90-ft segment.
 *   • Each runner has an independent time cursor, so multiple runners
 *     advance in PARALLEL (not serialized after the fielder's play).
 *   • Multi-base advances (double, triple, etc.) emit one event per
 *     90-ft segment so the renderer naturally routes the runner through
 *     each intervening base instead of cutting straight across the diamond.
 *
 * NOTE: This mirrors `game.ts/advanceRunners` but is *event-emitting*
 * rather than result-only.
 */
function emitBaseRunningEvents(
  ab: AtBatRecord,
  bases: (Player | null)[],
  outsBefore: number,
  scoreHome: { v: number },
  scoreAway: { v: number },
  battingTeamId: number,
  battingTeamIsHome: boolean,
  startT: number,
  pushAt: (e: SimEventInit, absT: number) => void,
  throwArrivesAt?: number,
): { newBases: (Player | null)[]; outsAfter: number; latestT: number } {
  const [r1, r2, r3] = bases;
  const batter = ab.batter;
  let nb: (Player | null)[] = [r1, r2, r3];
  let outsAfter = outsBefore;
  let latestT = startT;

  // Per-runner time cursor (defaults to startT until a runner moves).
  const runnerT = new Map<number, number>();
  const tOf = (id: number) => runnerT.get(id) ?? startT;

  type Base = 'home' | 'first' | 'second' | 'third';
  const ORDER: Base[] = ['home', 'first', 'second', 'third'];
  const idx = (b: Base) => ORDER.indexOf(b);

  /**
   * Build the path of bases a runner traverses going from `from` to `to`.
   * Always touches each intermediate bag in baseball order. `to` may be
   * 'home' meaning a full lap around (e.g. r1 scoring on a triple goes
   * first → second → third → home).
   */
  const pathBetween = (from: Base, to: Base | 'home'): Base[] => {
    const path: Base[] = [from];
    let cur = idx(from);
    // 'home' as destination from a non-home base means continue forward
    // (third → home), wrapping past 'third'.
    do {
      cur = (cur + 1) % 4;
      path.push(ORDER[cur]);
    } while (ORDER[cur] !== to);
    return path;
  };

  const score = (runner: Player, atT: number) => {
    if (battingTeamIsHome) scoreHome.v++;
    else scoreAway.v++;
    pushAt({
      type: 'run-scored',
      runnerId: runner.id,
      battingTeamId,
      scoreHome: scoreHome.v,
      scoreAway: scoreAway.v,
    }, atT + 0.05);
  };

  /**
   * Advance a runner from `from` through to `to`, emitting one
   * `runner-advance` event per 90-ft segment so the renderer touches
   * each intermediate base.
   */
  const advance = (runner: Player, from: Base, to: 'first' | 'second' | 'third' | 'home') => {
    const path = pathBetween(from, to);
    let cursor = tOf(runner.id);
    for (let i = 0; i < path.length - 1; i++) {
      pushAt({
        type: 'runner-advance',
        runnerId: runner.id,
        fromBase: path[i],
        toBase: path[i + 1] as 'first' | 'second' | 'third' | 'home',
        travelSec: TIME.perBaseSec,
      }, cursor);
      cursor += TIME.perBaseSec;
    }
    runnerT.set(runner.id, cursor);
    if (to === 'home') score(runner, cursor);
    if (cursor > latestT) latestT = cursor;
  };

  const recordOut = (runner: Player | undefined, atPosition?: Position, atTOverride?: number) => {
    outsAfter++;
    // Time the out at the runner's current cursor (when they reached the
    // bag where they were forced out), or startT for non-running outs
    // (strikeout, foul-out). `atTOverride` lets the caller align the out
    // with throw arrival for plays decided in the air.
    const atT = atTOverride ?? (runner ? tOf(runner.id) : startT);
    pushAt({
      type: 'out',
      outNum: outsAfter,
      reason: ab.result,
      atPosition,
      runnerId: runner?.id,
    }, atT + 0.05);
    if (atT + 0.05 > latestT) latestT = atT + 0.05;
  };

  switch (ab.result) {
    case 'walk':
    case 'hbp':
    case 'reached-on-error': {
      // Force advances
      let push1: Player | null = batter;
      let i = 0;
      while (push1 && i < 3) {
        const occupant = bases[i];
        nb[i] = push1;
        const fromBase = (['home', 'first', 'second'] as const)[i];
        const toBase = (['first', 'second', 'third'] as const)[i];
        advance(push1, fromBase, toBase);
        push1 = occupant;
        if (!occupant) { push1 = null; break; }
        i++;
      }
      if (push1) advance(push1, 'third', 'home');
      break;
    }
    case 'single': {
      if (r3) advance(r3, 'third', 'home');
      if (r2) advance(r2, 'second', 'home');
      if (r1) advance(r1, 'first', 'third');
      advance(batter, 'home', 'first');
      nb = [batter, null, r1 ?? null];
      break;
    }
    case 'double': {
      if (r3) advance(r3, 'third', 'home');
      if (r2) advance(r2, 'second', 'home');
      if (r1) advance(r1, 'first', 'third');
      advance(batter, 'home', 'second');
      nb = [null, batter, r1 ?? null];
      break;
    }
    case 'triple': {
      if (r3) advance(r3, 'third', 'home');
      if (r2) advance(r2, 'second', 'home');
      if (r1) advance(r1, 'first', 'home');
      advance(batter, 'home', 'third');
      nb = [null, null, batter];
      break;
    }
    case 'home-run': {
      if (r3) advance(r3, 'third', 'home');
      if (r2) advance(r2, 'second', 'home');
      if (r1) advance(r1, 'first', 'home');
      advance(batter, 'home', 'home');
      nb = [null, null, null];
      break;
    }
    case 'strikeout':
    case 'foul-out': {
      recordOut(batter);
      break;
    }
    case 'pop-out':
    case 'line-out':
    case 'fly-out': {
      recordOut(batter, ab.fieldedBy);
      break;
    }
    case 'ground-out': {
      // Batter sprints toward first while the throw is in flight; out is
      // recorded when the throw arrives at the bag (see throwArrivesAt).
      advance(batter, 'home', 'first');
      recordOut(batter, ab.fieldedBy, throwArrivesAt);
      break;
    }
    case 'double-play': {
      // Batter out at 1B, lead runner (1B) out at 2B.
      // Runners on 2B/3B were not forced and hold.
      if (r1) {
        // Runner moves toward 2B; called out when relay arrives.
        advance(r1, 'first', 'second');
        recordOut(r1, 'B2', throwArrivesAt);
      }
      // Batter sprinting toward 1B; out when relay throw arrives. Add an
      // extra ~0.6s for the pivot/relay throw beyond the initial fielding.
      advance(batter, 'home', 'first');
      recordOut(batter, 'B1', throwArrivesAt != null ? throwArrivesAt + 0.6 : undefined);
      nb = [null, r2 ?? null, r3 ?? null];
      break;
    }
    case 'fielders-choice': {
      // Lead runner out at 2B; batter to 1B safely. Other runners hold.
      if (r1) {
        advance(r1, 'first', 'second');
        recordOut(r1, 'B2', throwArrivesAt);
      }
      advance(batter, 'home', 'first');
      nb = [batter, r2 ?? null, r3 ?? null];
      break;
    }
    case 'sac-fly': {
      recordOut(batter, ab.fieldedBy);
      if (r3) advance(r3, 'third', 'home');
      nb = [r1, null, r2 ?? null];
      break;
    }
  }

  return { newBases: nb, outsAfter, latestT };
}

// ─── Main builder ──────────────────────────────────────────────
export function buildEvents(g: GameResult): SimEvent[] {
  const events: SimEvent[] = [];
  let seq = 0;
  let t = 0;
  const scoreHome = { v: 0 };
  const scoreAway = { v: 0 };

  /** Push an event at `t + dt` and advance the global clock. */
  const push = (e: SimEventInit, dt: number) => {
    t += dt;
    events.push({ ...(e as SimEvent), seq: seq++, t });
  };

  /** Push an event at an absolute time without advancing the global clock.
   *  Used for parallel actions (e.g. runners moving while a fielder fields). */
  const pushAt = (e: SimEventInit, absT: number) => {
    events.push({ ...(e as SimEvent), seq: seq++, t: Math.max(0, absT) });
  };

  // Game start
  push({
    type: 'game-start',
    homeTeamId: g.homeTeam.id, homeTeamName: g.homeTeam.name,
    awayTeamId: g.awayTeam.id, awayTeamName: g.awayTeam.name,
  }, 0);

  // Group at-bats by inning + half so we can emit inning boundaries
  let lastInning = -1;
  let lastHalf: 'top' | 'bottom' | '' = '';
  let bases: (Player | null)[] = [null, null, null];
  let outsInInning = 0;

  const emitInningStart = (ab: AtBatRecord, fieldingTeam: typeof g.homeTeam) => {
    // Build defense snapshot from team lineup; pitcher comes from the at-bat
    const defense: InningStartEvent['defense'] = [];
    for (const p of fieldingTeam.lineup) {
      if (p.position === 'P') continue;
      defense.push({
        position: p.position, playerId: p.id,
        firstName: p.firstName, lastName: p.lastName,
      });
    }
    defense.push({
      position: 'P', playerId: ab.pitcher.id,
      firstName: ab.pitcher.firstName, lastName: ab.pitcher.lastName,
    });
    const battingTeam = ab.half === 'top' ? g.awayTeam : g.homeTeam;
    push({
      type: 'inning-start',
      inning: ab.inning, half: ab.half,
      battingTeamId: battingTeam.id, fieldingTeamId: fieldingTeam.id,
      defense,
    }, TIME.betweenInningsSec);
  };

  for (const ab of g.atBats) {
    if (ab.inning !== lastInning || ab.half !== lastHalf) {
      // End previous inning if any
      if (lastInning > 0) {
        push({
          type: 'inning-end',
          inning: lastInning, half: lastHalf as 'top' | 'bottom',
          scoreHome: scoreHome.v, scoreAway: scoreAway.v,
        }, 0);
      }
      const fieldingTeam = ab.half === 'top' ? g.homeTeam : g.awayTeam;
      emitInningStart(ab, fieldingTeam);
      lastInning = ab.inning; lastHalf = ab.half;
      bases = [null, null, null];
      outsInInning = 0;
    }

    // At-bat start
    push({
      type: 'at-bat-start',
      inning: ab.inning, half: ab.half, outs: outsInInning,
      batter: {
        id: ab.batter.id, firstName: ab.batter.firstName,
        lastName: ab.batter.lastName, hand: ab.batter.hand,
      },
      pitcher: {
        id: ab.pitcher.id, firstName: ab.pitcher.firstName,
        lastName: ab.pitcher.lastName,
        // Pitchers are never switch; coerce 'S' → 'R' just in case.
        hand: ab.pitcher.hand === 'L' ? 'L' : 'R',
      },
      runners: bases.map(b => b?.id ?? null),
    }, TIME.betweenAtBatsSec);

    // Pitches
    let lastContactT: number | null = null;
    for (const p of ab.pitches) {
      push({
        type: 'pitch',
        pitchNum: p.pitchNum, balls: p.balls, strikes: p.strikes,
        intentZone: p.intentZone, actualInZone: p.actualInZone,
        swung: p.swung, outcome: p.outcome,
        flightSec: TIME.pitchToHomeSec,
      }, TIME.betweenPitchesSec);

      // If contact → emit Contact + fielder/throw events
      if (p.outcome === 'in-play' && ab.battedBall) {
        // Capture contact time BEFORE emitBattedBallVisuals advances `t`.
        lastContactT = t;
        emitBattedBallVisuals(ab.battedBall, ab, push);
      }
    }

    // Base running + outs + runs.
    // Runners start moving `runnerReactionSec` after contact (in parallel
    // with the fielding play). For non-contact results (walk, K, etc.) they
    // start at the current global clock.
    const battingTeamIsHome = ab.half === 'bottom';
    const battingTeamId = battingTeamIsHome ? g.homeTeam.id : g.awayTeam.id;
    const runnerStartT = lastContactT != null
      ? lastContactT + TIME.runnerReactionSec
      : t + 0.05;
    // Throw arrival time for plays decided at a base (ground-out, FC, DP).
    // contact_t + hangTime + glove-to-release + throw flight.
    const throwArrivesAt = lastContactT != null && ab.battedBall
      ? lastContactT + (ab.battedBall.hangTimeSec || TIME.contactToFieldedDefault)
        + TIME.fieldedToThrowSec + TIME.throwToBaseSec
      : undefined;
    const { newBases, outsAfter, latestT } = emitBaseRunningEvents(
      ab, bases, outsInInning, scoreHome, scoreAway,
      battingTeamId, battingTeamIsHome, runnerStartT, pushAt, throwArrivesAt,
    );
    bases = newBases;
    outsInInning = outsAfter;
    // Catch the global clock up to the latest runner/out event so
    // `at-bat-end` doesn't fire while a runner is still tweening.
    if (latestT > t) t = latestT;

    push({
      type: 'at-bat-end',
      result: ab.result, rbis: ab.rbis, runsScored: ab.runsScored,
    }, 0.1);

    if (outsInInning >= 3) {
      // inning-end pushed when next at-bat starts (or at game end)
    }
  }

  // Final inning-end
  if (lastInning > 0) {
    push({
      type: 'inning-end',
      inning: lastInning, half: lastHalf as 'top' | 'bottom',
      scoreHome: scoreHome.v, scoreAway: scoreAway.v,
    }, 0);
  }

  push({
    type: 'game-end',
    scoreHome: scoreHome.v, scoreAway: scoreAway.v,
    innings: g.innings,
  }, 0);

  // Sanity: derived score should match the result
  if (scoreHome.v !== g.homeRuns || scoreAway.v !== g.awayRuns) {
    // Don't throw — log for debugging. Mismatches indicate the runner
    // model in this file drifted from `game.ts`.
    // eslint-disable-next-line no-console
    console.warn(
      `[events] derived score (${scoreAway.v}-${scoreHome.v}) ` +
      `differs from result (${g.awayRuns}-${g.homeRuns})`,
    );
  }

  // Sort by absolute timestamp (stable via seq) so the parallel events
  // emitted via `pushAt` are interleaved correctly with the sequential
  // ones emitted via `push`.
  events.sort((a, b) => a.t - b.t || a.seq - b.seq);

  return events;
}

function emitBattedBallVisuals(
  ball: BattedBall,
  ab: AtBatRecord,
  push: (e: SimEventInit, dt: number) => void,
): void {
  push({
    type: 'contact',
    exitVeloMph: ball.exitVeloMph,
    launchAngleDeg: ball.launchAngleDeg,
    sprayAngleDeg: ball.sprayAngleDeg,
    distanceFt: ball.distanceFt,
    hangTimeSec: ball.hangTimeSec,
    landingPoint: ball.landingPoint,
    isFoul: ball.isFoul,
    isHomeRun: ball.isHomeRun,
  }, 0);

  // Fielder converge/throw — only if a fielder was assigned
  if (!ab.fieldedBy) return;
  const fielderPt = FIELDER_POSITIONS_FT[ab.fieldedBy];
  push({
    type: 'fielder-converge',
    position: ab.fieldedBy,
    playerId: -1,                    // not tracked in AtBatRecord; renderer can resolve via inning-start defense
    fromPoint: fielderPt,
    toPoint: ball.landingPoint,
    reachSec: ball.hangTimeSec || TIME.contactToFieldedDefault,
  }, ball.hangTimeSec || TIME.contactToFieldedDefault);

  // Infielder throw to 1B for ground-outs / FCs
  const isInfielder = !['LF', 'CF', 'RF'].includes(ab.fieldedBy);
  const isCaught = ['fly-out', 'line-out', 'pop-out', 'sac-fly'].includes(ab.result);
  if (!isCaught && isInfielder) {
    const targetBase = ab.result === 'double-play' || ab.result === 'fielders-choice'
      ? 'second' as const
      : 'first' as const;
    // Pick who covers the target base. Default cover fielder for the bag,
    // but if the cover fielder is the one who just fielded the ball, fall
    // back to a sensible alternate (e.g. P covers 1B if B1 fielded it).
    const defaultCover: Record<'first' | 'second' | 'third' | 'home', Position> = {
      first: 'B1', second: 'B2', third: 'B3', home: 'C',
    };
    let coverPos: Position = defaultCover[targetBase];
    if (coverPos === ab.fieldedBy) {
      if (targetBase === 'first') coverPos = 'P';
      else if (targetBase === 'second') coverPos = ab.fieldedBy === 'B2' ? 'SS' : 'B2';
      else if (targetBase === 'third') coverPos = 'SS';
      else coverPos = 'P';
    }
    // Cover fielder breaks the moment the ball is fielded (same time the
    // throw is released). Time to the bag is the throw flight minus a
    // small head-start so they're set when the ball arrives.
    const coverArrive = Math.max(0.4, TIME.throwToBaseSec - 0.2);
    push({
      type: 'cover-base',
      position: coverPos,
      base: targetBase,
      fromPoint: FIELDER_POSITIONS_FT[coverPos],
      toPoint: basePoint(targetBase),
      arriveSec: coverArrive,
    }, 0);
    push({
      type: 'throw',
      fromPosition: ab.fieldedBy, fromPlayerId: -1,
      fromPoint: ball.landingPoint,
      toBase: targetBase,
      toPoint: basePoint(targetBase),
      flightSec: TIME.throwToBaseSec,
    }, TIME.fieldedToThrowSec);
  }

  void isOut;  // referenced via base-running emitter
}
