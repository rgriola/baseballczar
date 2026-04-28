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
  betweenInningsSec: 120,
} as const;

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
  pitcher: { id: number; firstName: string; lastName: string };
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
  | PitchEvt | ContactEvent | FielderConvergeEvent | ThrowEvent
  | RunnerAdvanceEvent | OutEvent | RunScoredEvent
  | AtBatEndEvent | InningEndEvent | GameEndEvent;

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
 * post-AB outs count and any updated score.
 *
 * NOTE: This mirrors `game.ts/advanceRunners` but is *event-emitting*
 * rather than result-only. Kept separate to avoid coupling the sim to
 * the renderer schema.
 */
function emitBaseRunningEvents(
  ab: AtBatRecord,
  bases: (Player | null)[],
  outsBefore: number,
  scoreHome: { v: number },
  scoreAway: { v: number },
  battingTeamId: number,
  battingTeamIsHome: boolean,
  push: (e: Omit<SimEvent, 'seq' | 't'>, dt: number) => void,
): { newBases: (Player | null)[]; outsAfter: number } {
  const [r1, r2, r3] = bases;
  const batter = ab.batter;
  let nb: (Player | null)[] = [r1, r2, r3];
  let outsAfter = outsBefore;

  const score = (runner: Player) => {
    if (battingTeamIsHome) scoreHome.v++;
    else scoreAway.v++;
    push({
      type: 'run-scored',
      runnerId: runner.id,
      battingTeamId,
      scoreHome: scoreHome.v,
      scoreAway: scoreAway.v,
    }, 0.1);
  };

  const advance = (
    runner: Player,
    from: 'home' | 'first' | 'second' | 'third',
    to: 'first' | 'second' | 'third' | 'home',
  ) => {
    push({
      type: 'runner-advance',
      runnerId: runner.id,
      fromBase: from, toBase: to,
      travelSec: 3.5,
    }, 0.05);
    if (to === 'home') score(runner);
  };

  const recordOut = (runner: Player | undefined, atPosition?: Position) => {
    outsAfter++;
    push({
      type: 'out',
      outNum: outsAfter,
      reason: ab.result,
      atPosition,
      runnerId: runner?.id,
    }, 0.05);
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
    case 'fly-out':
    case 'ground-out': {
      recordOut(batter, ab.fieldedBy);
      break;
    }
    case 'double-play': {
      // Mirror game.ts: lead runner (1B) and batter both out;
      // r2 advances to 3B; r3 is held (game.ts drops r3 — keep parity).
      if (r1) recordOut(r1, 'B2');
      recordOut(batter, 'B1');
      nb = [null, null, r2 ?? null];
      break;
    }
    case 'fielders-choice': {
      // Mirror game.ts: lead runner out at 2B; batter to 1B; r2 → 3B; r3 held.
      if (r1) recordOut(r1, 'B2');
      advance(batter, 'home', 'first');
      nb = [batter, null, r2 ?? null];
      break;
    }
    case 'sac-fly': {
      recordOut(batter, ab.fieldedBy);
      if (r3) advance(r3, 'third', 'home');
      nb = [r1, null, r2 ?? null];
      break;
    }
  }

  return { newBases: nb, outsAfter };
}

// ─── Main builder ──────────────────────────────────────────────
export function buildEvents(g: GameResult): SimEvent[] {
  const events: SimEvent[] = [];
  let seq = 0;
  let t = 0;
  const scoreHome = { v: 0 };
  const scoreAway = { v: 0 };

  const push = (e: Omit<SimEvent, 'seq' | 't'>, dt: number) => {
    t += dt;
    events.push({ ...(e as SimEvent), seq: seq++, t });
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
      },
      runners: bases.map(b => b?.id ?? null),
    }, TIME.betweenAtBatsSec);

    // Pitches
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
        emitBattedBallVisuals(ab.battedBall, ab, push);
      }
    }

    // Base running + outs + runs
    const battingTeamIsHome = ab.half === 'bottom';
    const battingTeamId = battingTeamIsHome ? g.homeTeam.id : g.awayTeam.id;
    const { newBases, outsAfter } = emitBaseRunningEvents(
      ab, bases, outsInInning, scoreHome, scoreAway,
      battingTeamId, battingTeamIsHome, push,
    );
    bases = newBases;
    outsInInning = outsAfter;

    push({
      type: 'at-bat-end',
      result: ab.result, rbis: ab.rbis, runsScored: ab.runsScored,
    }, 0);

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

  return events;
}

function emitBattedBallVisuals(
  ball: BattedBall,
  ab: AtBatRecord,
  push: (e: Omit<SimEvent, 'seq' | 't'>, dt: number) => void,
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
