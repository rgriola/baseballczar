// Last touched by agent: 2026-05-06T03:12:05Z
// Purpose: Adapts package sim-engine scheduled outputs to legacy persistence types.

import {
  buildEvents,
  type AtBatRecord as V2AtBatRecord,
  type AtBatResult as V2AtBatResult,
  type BatterGameStats as V2BatterGameStats,
  type BattedBall as V2BattedBall,
  type GameResult as V2GameResult,
  type PitcherGameStats as V2PitcherGameStats,
  type SimEvent as V2SimEvent,
} from '@baseballczar/sim-engine';
import { addInningScore, createScoreBoard } from '../sim-engine/ScoreBoard';
import {
  AtBatOutcome,
  type BallPathWaypoint,
  type BaseOccupancyState,
  type GameEvent as LegacyGameEvent,
  type GameResult as LegacyGameResult,
  type GameStats as LegacyGameStats,
  type PitcherBoxLine,
  type ScoreBoardState,
} from '../sim-engine/types';

export interface ScheduledTeamAdapterInput {
  teamId: number;
  teamName: string;
  hitterIds: Set<number>;
  pitcherIds: Set<number>;
  starterPitcherId: number;
}

function isHitResult(result: V2AtBatResult): boolean {
  return result === 'single' || result === 'double' || result === 'triple' || result === 'home-run';
}

function isOutResult(result: V2AtBatResult): boolean {
  return (
    result === 'ground-out'
    || result === 'fly-out'
    || result === 'line-out'
    || result === 'pop-out'
    || result === 'foul-out'
    || result === 'strikeout'
    || result === 'double-play'
    || result === 'fielders-choice'
    || result === 'sac-fly'
  );
}

function outsFromResult(result: V2AtBatResult): number {
  if (result === 'double-play') return 2;
  return isOutResult(result) ? 1 : 0;
}

function mapOutcomeToLegacy(result: V2AtBatResult): AtBatOutcome {
  if (result === 'single') return AtBatOutcome.Single;
  if (result === 'double') return AtBatOutcome.Double;
  if (result === 'triple') return AtBatOutcome.Triple;
  if (result === 'home-run') return AtBatOutcome.HomeRun;
  if (result === 'walk' || result === 'hbp') return AtBatOutcome.Walk;
  if (result === 'strikeout') return AtBatOutcome.Strikeout;
  return AtBatOutcome.GroundOut;
}

function mapHitZone(ball: V2BattedBall | undefined, result: V2AtBatResult): LegacyGameEvent['hitZone'] {
  if (!ball) return undefined;

  if (ball.distanceFt <= 120 || result === 'ground-out' || result === 'fielders-choice' || result === 'double-play') {
    return 'INFIELD';
  }

  const spray = ball.sprayAngleDeg;
  if (spray <= -55) return 'LF_LINE';
  if (spray <= -22) return 'LF';
  if (spray < -8) return 'LCF';
  if (spray <= 8) return 'CF';
  if (spray < 22) return 'RCF';
  if (spray < 55) return 'RF';
  return 'RF_LINE';
}

type V2AtBatStartEvent = Extract<V2SimEvent, { type: 'at-bat-start' }>;

const EMPTY_BASE_OCCUPANCY: BaseOccupancyState = {
  first: null,
  second: null,
  third: null,
};

function cloneBaseOccupancy(base: BaseOccupancyState): BaseOccupancyState {
  return {
    first: base.first,
    second: base.second,
    third: base.third,
  };
}

function runnersToBaseOccupancy(runners: Array<number | null>): BaseOccupancyState {
  return {
    first: runners[0] ?? null,
    second: runners[1] ?? null,
    third: runners[2] ?? null,
  };
}

function deriveBaseOccupancyTelemetry(
  result: V2GameResult,
): {
  before: BaseOccupancyState[];
  after: BaseOccupancyState[];
} {
  const emptyBefore = result.atBats.map(() => cloneBaseOccupancy(EMPTY_BASE_OCCUPANCY));
  const emptyAfter = result.atBats.map(() => cloneBaseOccupancy(EMPTY_BASE_OCCUPANCY));

  const starts = buildEvents(result)
    .filter((event): event is V2AtBatStartEvent => event.type === 'at-bat-start');

  if (starts.length !== result.atBats.length) {
    return { before: emptyBefore, after: emptyAfter };
  }

  const before = starts.map((start) => runnersToBaseOccupancy(start.runners));
  const after = starts.map((start, index) => {
    const next = starts[index + 1];
    if (next && next.inning === start.inning && next.half === start.half) {
      return runnersToBaseOccupancy(next.runners);
    }
    return cloneBaseOccupancy(EMPTY_BASE_OCCUPANCY);
  });

  return { before, after };
}

function appendWaypoint(
  waypoints: BallPathWaypoint[],
  label: string,
  x: number,
  y: number,
  z: number,
  tSec?: number,
): void {
  if (![x, y, z].every(Number.isFinite)) return;
  const next: BallPathWaypoint = { label, x, y, z };
  if (typeof tSec === 'number' && Number.isFinite(tSec)) {
    next.tSec = tSec;
  }

  const prev = waypoints[waypoints.length - 1];
  if (
    prev
    && Math.abs(prev.x - next.x) < 0.001
    && Math.abs(prev.y - next.y) < 0.001
    && Math.abs(prev.z - next.z) < 0.001
  ) {
    return;
  }

  waypoints.push(next);
}

function buildBallPathWaypoints(ball: V2BattedBall | undefined): BallPathWaypoint[] | undefined {
  if (!ball) return undefined;

  const waypoints: BallPathWaypoint[] = [];
  appendWaypoint(waypoints, 'contact', 0, 0, 3, 0);

  const landingDist = Math.hypot(ball.landingPoint.x, ball.landingPoint.y);
  const wallHitDist = ball.wallHitPoint
    ? Math.hypot(ball.wallHitPoint.x, ball.wallHitPoint.y)
    : null;
  const wallBeforeLanding = wallHitDist != null && wallHitDist <= landingDist + 0.5;

  if (ball.wallHitPoint && wallBeforeLanding) {
    appendWaypoint(
      waypoints,
      'wall-hit',
      ball.wallHitPoint.x,
      ball.wallHitPoint.y,
      10,
    );
  }

  appendWaypoint(
    waypoints,
    'landing',
    ball.landingPoint.x,
    ball.landingPoint.y,
    0,
    ball.hangTimeSec,
  );

  if (ball.wallHitPoint && !wallBeforeLanding) {
    appendWaypoint(
      waypoints,
      'wall-hit',
      ball.wallHitPoint.x,
      ball.wallHitPoint.y,
      10,
    );
  }

  if (ball.fieldedAtPoint) {
    appendWaypoint(
      waypoints,
      'fielded',
      ball.fieldedAtPoint.x,
      ball.fieldedAtPoint.y,
      0,
      ball.fieldedAtSec,
    );
  }

  const restDx = ball.restPoint.x - ball.landingPoint.x;
  const restDy = ball.restPoint.y - ball.landingPoint.y;
  if (Math.hypot(restDx, restDy) > 0.25) {
    appendWaypoint(
      waypoints,
      'rest',
      ball.restPoint.x,
      ball.restPoint.y,
      0,
    );
  }

  return waypoints.length > 0 ? waypoints : undefined;
}

function describeAtBat(atBat: V2AtBatRecord): string {
  const batter = `${atBat.batter.firstName[0]}. ${atBat.batter.lastName}`;
  if (atBat.result === 'single') return `${batter} singles.`;
  if (atBat.result === 'double') return `${batter} doubles.`;
  if (atBat.result === 'triple') return `${batter} triples.`;
  if (atBat.result === 'home-run') return `${batter} homers.`;
  if (atBat.result === 'walk') return `${batter} walks.`;
  if (atBat.result === 'hbp') return `${batter} hit by pitch.`;
  if (atBat.result === 'strikeout') return `${batter} strikes out.`;
  if (atBat.result === 'double-play') return `${batter} grounds into a double play.`;
  if (atBat.result === 'sac-fly') return `${batter} hits a sacrifice fly.`;
  if (atBat.result === 'fielders-choice') return `${batter} reaches on fielder's choice.`;
  if (atBat.result === 'reached-on-error') return `${batter} reaches on error.`;
  if (atBat.result === 'foul-out') return `${batter} fouls out.`;
  if (atBat.result === 'line-out') return `${batter} lines out.`;
  if (atBat.result === 'pop-out') return `${batter} pops out.`;
  return `${batter} grounds out.`;
}

function toLegacyHitterStats(stats: V2BatterGameStats): LegacyGameStats {
  const singles = Math.max(0, stats.hits - stats.doubles - stats.triples - stats.homeRuns);
  return {
    ab: stats.ab,
    r: stats.runs,
    b1: singles,
    b2: stats.doubles,
    b3: stats.triples,
    hr: stats.homeRuns,
    rbi: stats.rbis,
    bb: stats.walks,
    so: stats.strikeouts,
    hits: stats.hits,
  };
}

function emptyPitcherLine(): PitcherBoxLine {
  return {
    g: 0,
    gs: 0,
    w: 0,
    l: 0,
    sv: 0,
    cg: 0,
    sho: 0,
    ip: 0,
    om: 0,
    bf: 0,
    h: 0,
    r: 0,
    er: 0,
    bb: 0,
    so: 0,
    hr: 0,
  };
}

function toLegacyPitcherLine(stats: V2PitcherGameStats, starterId: number): PitcherBoxLine {
  return {
    g: stats.battersFaced > 0 ? 1 : 0,
    gs: stats.pitcherId === starterId ? 1 : 0,
    w: 0,
    l: 0,
    sv: 0,
    cg: 0,
    sho: 0,
    ip: stats.outs / 3,
    om: stats.outs,
    bf: stats.battersFaced,
    h: stats.hits,
    r: stats.runs,
    er: stats.earnedRuns,
    bb: stats.walks,
    so: stats.strikeouts,
    hr: stats.homeRuns,
  };
}

function awardPitcherDecision(lines: Map<number, PitcherBoxLine>, decision: 'w' | 'l'): void {
  let bestId: number | null = null;
  let bestOuts = -1;
  for (const [pitcherId, line] of lines.entries()) {
    if (line.om > bestOuts) {
      bestOuts = line.om;
      bestId = pitcherId;
    }
  }
  if (bestId == null) return;
  const best = lines.get(bestId);
  if (!best) return;
  best[decision] = 1;
}

function applyCompleteGameFlags(
  lines: Map<number, PitcherBoxLine>,
  starterId: number,
  runsAllowed: number,
): void {
  const used = Array.from(lines.values()).filter((line) => line.g > 0);
  if (used.length !== 1) return;
  const starter = lines.get(starterId);
  if (!starter || starter.om < 27) return;
  starter.cg = 1;
  if (runsAllowed === 0) starter.sho = 1;
}

export function adaptV2ResultToLegacy(
  result: V2GameResult,
  visitor: ScheduledTeamAdapterInput,
  home: ScheduledTeamAdapterInput,
): LegacyGameResult {
  const visitorPlayerStats = new Map<number, LegacyGameStats>();
  const homePlayerStats = new Map<number, LegacyGameStats>();
  for (const [playerId, stats] of result.batterStats.entries()) {
    if (visitor.hitterIds.has(playerId)) {
      visitorPlayerStats.set(playerId, toLegacyHitterStats(stats));
    } else if (home.hitterIds.has(playerId)) {
      homePlayerStats.set(playerId, toLegacyHitterStats(stats));
    }
  }
  for (const playerId of visitor.hitterIds) {
    if (!visitorPlayerStats.has(playerId)) {
      visitorPlayerStats.set(playerId, {
        ab: 0,
        r: 0,
        b1: 0,
        b2: 0,
        b3: 0,
        hr: 0,
        rbi: 0,
        bb: 0,
        so: 0,
        hits: 0,
      });
    }
  }
  for (const playerId of home.hitterIds) {
    if (!homePlayerStats.has(playerId)) {
      homePlayerStats.set(playerId, {
        ab: 0,
        r: 0,
        b1: 0,
        b2: 0,
        b3: 0,
        hr: 0,
        rbi: 0,
        bb: 0,
        so: 0,
        hits: 0,
      });
    }
  }

  const visitorPitcherStats = new Map<number, PitcherBoxLine>();
  const homePitcherStats = new Map<number, PitcherBoxLine>();
  for (const [playerId, stats] of result.pitcherStats.entries()) {
    if (visitor.pitcherIds.has(playerId)) {
      visitorPitcherStats.set(playerId, toLegacyPitcherLine(stats, visitor.starterPitcherId));
    } else if (home.pitcherIds.has(playerId)) {
      homePitcherStats.set(playerId, toLegacyPitcherLine(stats, home.starterPitcherId));
    }
  }
  for (const playerId of visitor.pitcherIds) {
    if (!visitorPitcherStats.has(playerId)) {
      visitorPitcherStats.set(playerId, emptyPitcherLine());
    }
  }
  for (const playerId of home.pitcherIds) {
    if (!homePitcherStats.has(playerId)) {
      homePitcherStats.set(playerId, emptyPitcherLine());
    }
  }

  const innings = Math.max(9, result.innings);
  const topRuns = new Array<number>(innings + 1).fill(0);
  const topHits = new Array<number>(innings + 1).fill(0);
  const bottomRuns = new Array<number>(innings + 1).fill(0);
  const bottomHits = new Array<number>(innings + 1).fill(0);

  let visitorRuns = 0;
  let homeRuns = 0;
  let visitorHits = 0;
  let homeHits = 0;
  const events: LegacyGameEvent[] = [];
  const baseTelemetry = deriveBaseOccupancyTelemetry(result);

  for (const [atBatIdx, atBat] of result.atBats.entries()) {
    const hit = isHitResult(atBat.result);
    if (atBat.half === 'top') {
      visitorRuns += atBat.runsScored;
      topRuns[atBat.inning] += atBat.runsScored;
      if (hit) {
        visitorHits++;
        topHits[atBat.inning]++;
      }
    } else {
      homeRuns += atBat.runsScored;
      bottomRuns[atBat.inning] += atBat.runsScored;
      if (hit) {
        homeHits++;
        bottomHits[atBat.inning]++;
      }
    }

    const outs = Math.min(3, atBat.outs + outsFromResult(atBat.result));
    const runnersScored = atBat.runsScored > 0
      ? Array.from({ length: atBat.runsScored }, () => 'Run scores')
      : [];

    events.push({
      inning: atBat.inning,
      half: atBat.half,
      outs,
      batterName: atBat.batter.lastName,
      pitcherName: atBat.pitcher.lastName,
      outcome: mapOutcomeToLegacy(atBat.result),
      description: describeAtBat(atBat),
      visitorRuns,
      homeRuns,
      visitorHits,
      homeHits,
      runnersScored,
      hitZone: mapHitZone(atBat.battedBall, atBat.result),
      sprayAngleDeg: atBat.battedBall?.sprayAngleDeg,
      launchAngleDeg: atBat.battedBall?.launchAngleDeg,
      exitVeloMph: atBat.battedBall?.exitVeloMph,
      ballPathWaypoints: buildBallPathWaypoints(atBat.battedBall),
      baseOccupancyBefore: baseTelemetry.before[atBatIdx] ?? cloneBaseOccupancy(EMPTY_BASE_OCCUPANCY),
      baseOccupancyAfter: baseTelemetry.after[atBatIdx] ?? cloneBaseOccupancy(EMPTY_BASE_OCCUPANCY),
    });
  }

  const scoreBoard: ScoreBoardState = createScoreBoard(
    visitor.teamName,
    visitor.teamId,
    home.teamName,
    home.teamId,
  );
  let topRunsTotal = 0;
  let topHitsTotal = 0;
  let bottomRunsTotal = 0;
  let bottomHitsTotal = 0;
  for (let inning = 1; inning <= innings; inning++) {
    topRunsTotal += topRuns[inning];
    topHitsTotal += topHits[inning];
    addInningScore(scoreBoard, 'top', inning, topRuns[inning], topHits[inning], topRunsTotal, topHitsTotal);

    bottomRunsTotal += bottomRuns[inning];
    bottomHitsTotal += bottomHits[inning];
    addInningScore(
      scoreBoard,
      'bottom',
      inning,
      bottomRuns[inning],
      bottomHits[inning],
      bottomRunsTotal,
      bottomHitsTotal,
    );
  }

  const homeWon = result.homeRuns > result.awayRuns;
  if (homeWon) {
    awardPitcherDecision(homePitcherStats, 'w');
    awardPitcherDecision(visitorPitcherStats, 'l');
  } else {
    awardPitcherDecision(visitorPitcherStats, 'w');
    awardPitcherDecision(homePitcherStats, 'l');
  }

  applyCompleteGameFlags(homePitcherStats, home.starterPitcherId, result.awayRuns);
  applyCompleteGameFlags(visitorPitcherStats, visitor.starterPitcherId, result.homeRuns);

  return {
    homeTeamId: result.homeTeam.id,
    visitorTeamId: result.awayTeam.id,
    homeRuns: result.homeRuns,
    visitorRuns: result.awayRuns,
    homeHits,
    visitorHits,
    innings,
    winningTeamId: homeWon ? result.homeTeam.id : result.awayTeam.id,
    losingTeamId: homeWon ? result.awayTeam.id : result.homeTeam.id,
    events,
    scoreBoard,
    homePlayerStats,
    visitorPlayerStats,
    homePitcherStats,
    visitorPitcherStats,
  };
}
