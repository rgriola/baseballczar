// Last touched by agent: 2026-05-06T15:02:00Z
// Purpose: Builds persisted replay snapshots directly from stored game telemetry.

import {
  FIELDER_POSITIONS_FT,
  type Position,
} from '@baseballczar/sim-engine';
import type {
  FielderEntity,
  TickEvent,
  WorldSnapshot,
} from '@baseballczar/tick-engine';

export type PersistedBallPathWaypoint = {
  label: string;
  x: number;
  y: number;
  z: number;
  tSec?: number;
};

export type PersistedBaseOccupancy = {
  first: number | null;
  second: number | null;
  third: number | null;
};

export type PersistedGameEventRow = {
  seq: number;
  inning: number;
  half: 'top' | 'bottom';
  outs: number;
  batter_name: string;
  pitcher_name: string;
  outcome: number;
  description: string | null;
  visitor_runs: number;
  home_runs: number;
  runners_scored: string[] | null;
  hit_zone: string | null;
  spray_angle_deg: number | null;
  launch_angle_deg: number | null;
  exit_velo_mph: number | null;
  ball_path_waypoints: unknown;
  base_occupancy_before: unknown;
  base_occupancy_after: unknown;
};

export type PersistedGameRow = {
  id: number;
  home_team_id: number;
  visitor_team_id: number;
  home_runs: number;
  visitor_runs: number;
  home_hits: number;
  visitor_hits: number;
  home_errors: number;
  visitor_errors: number;
  innings: number;
  home_linescore: number[] | null;
  visitor_linescore: number[] | null;
};

export type PersistedPlayerName = {
  first_name?: string | null;
  last_name?: string | null;
  jersey_no?: number | null;
  position?: string | null;
};

export type PersistedHittingRow = {
  id: number;
  team_id: number;
  player_id: number;
  bat_order: number;
  position: string | null;
  ab: number;
  r: number;
  h: number;
  b2: number;
  b3: number;
  hr: number;
  rbi: number;
  bb: number;
  so: number;
  players?: PersistedPlayerName | PersistedPlayerName[] | null;
};

export type PersistedPitchingRow = {
  id: number;
  team_id: number;
  player_id: number;
  pitch_app: number;
  ip: number;
  h: number;
  r: number;
  bb: number;
  so: number;
  hr: number;
  players?: PersistedPlayerName | PersistedPlayerName[] | null;
};

export type PersistedGamePayload = {
  game: PersistedGameRow;
  teamMap: Record<string, string>;
  events: PersistedGameEventRow[];
  hitting: PersistedHittingRow[];
  pitching: PersistedPitchingRow[];
};

export type ReplayBuild = {
  snapshots: WorldSnapshot[];
  totalDurationSec: number;
};

const OUTCOME = {
  single: 1,
  double: 2,
  triple: 3,
  homeRun: 4,
  walk: 5,
  groundOut: 6,
  strikeout: 7,
} as const;

const TEAM_COLOR = {
  homeDefense: 0x1e5631,
  awayDefense: 0x2a3a6e,
} as const;

const DEFENSE_POSITIONS: Position[] = ['P', 'C', 'B1', 'B2', 'SS', 'B3', 'LF', 'CF', 'RF'];

const ZONE_TO_POINT_FT: Record<string, { x: number; y: number }> = {
  LF_LINE: { x: -165, y: 215 },
  LF: { x: -130, y: 240 },
  LCF: { x: -75, y: 285 },
  CF: { x: 0, y: 320 },
  RCF: { x: 75, y: 285 },
  RF: { x: 130, y: 240 },
  RF_LINE: { x: 165, y: 215 },
  INFIELD: { x: -10, y: 95 },
};

const ZONE_TO_FIELDER: Record<string, Position> = {
  LF_LINE: 'LF',
  LF: 'LF',
  LCF: 'CF',
  CF: 'CF',
  RCF: 'CF',
  RF: 'RF',
  RF_LINE: 'RF',
  INFIELD: 'SS',
};

const CONTACT_PROFILE: Record<string, { ev: number; la: number }> = {
  single: { ev: 92, la: 12 },
  double: { ev: 98, la: 19 },
  triple: { ev: 101, la: 24 },
  'home-run': { ev: 106, la: 28 },
  'ground-out': { ev: 84, la: -4 },
};

export function num(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const parsed = Number(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function mapOutcomeCode(outcomeCode: number): string {
  if (outcomeCode === OUTCOME.single) return 'single';
  if (outcomeCode === OUTCOME.double) return 'double';
  if (outcomeCode === OUTCOME.triple) return 'triple';
  if (outcomeCode === OUTCOME.homeRun) return 'home-run';
  if (outcomeCode === OUTCOME.walk) return 'walk';
  if (outcomeCode === OUTCOME.strikeout) return 'strikeout';
  return 'ground-out';
}

function isBattedBallOutcome(outcome: string): boolean {
  return outcome === 'single'
    || outcome === 'double'
    || outcome === 'triple'
    || outcome === 'home-run'
    || outcome === 'ground-out';
}

function sprayToDirection(sprayDeg: number): string {
  if (sprayDeg <= -60) return 'LF-line';
  if (sprayDeg <= -25) return 'LF';
  if (sprayDeg < -8) return 'LCF';
  if (sprayDeg <= 8) return 'CF';
  if (sprayDeg < 25) return 'RCF';
  if (sprayDeg < 60) return 'RF';
  return 'RF-line';
}

function zonePointFt(zoneRaw: string | null): { x: number; y: number } {
  const zone = (zoneRaw ?? 'CF').toUpperCase();
  return ZONE_TO_POINT_FT[zone] ?? ZONE_TO_POINT_FT.CF;
}

function zoneFielder(zoneRaw: string | null): Position {
  const zone = (zoneRaw ?? 'CF').toUpperCase();
  return ZONE_TO_FIELDER[zone] ?? 'CF';
}

function normalizeBaseOccupancy(raw: unknown): PersistedBaseOccupancy | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const read = (k: string): number | null => {
    const value = obj[k];
    return typeof value === 'number' && Number.isFinite(value) ? value : null;
  };
  return {
    first: read('first'),
    second: read('second'),
    third: read('third'),
  };
}

function baseStateToArray(base: PersistedBaseOccupancy): string[] {
  const bases: string[] = [];
  if (base.first != null) bases.push('first');
  if (base.second != null) bases.push('second');
  if (base.third != null) bases.push('third');
  return bases;
}

function normalizeWaypoints(raw: unknown): PersistedBallPathWaypoint[] {
  if (!Array.isArray(raw)) return [];
  const out: PersistedBallPathWaypoint[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') continue;
    const obj = entry as Record<string, unknown>;
    const label = typeof obj.label === 'string' ? obj.label : '';
    const x = num(obj.x, Number.NaN);
    const y = num(obj.y, Number.NaN);
    const z = num(obj.z, Number.NaN);
    if (!label || !Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    const waypoint: PersistedBallPathWaypoint = { label, x, y, z };
    if (typeof obj.tSec === 'number' && Number.isFinite(obj.tSec)) {
      waypoint.tSec = obj.tSec;
    }
    out.push(waypoint);
  }
  return out;
}

function withFallbackWaypoints(row: PersistedGameEventRow, outcome: string): PersistedBallPathWaypoint[] {
  const existing = normalizeWaypoints(row.ball_path_waypoints);
  if (existing.length > 0) return existing;

  const landing = zonePointFt(row.hit_zone);
  const fallback: PersistedBallPathWaypoint[] = [
    { label: 'contact', x: 0, y: 0, z: 3, tSec: 0 },
    { label: 'landing', x: landing.x, y: landing.y, z: 0, tSec: outcome === 'ground-out' ? 1.1 : 2.4 },
  ];

  if (outcome !== 'home-run') {
    fallback.push({ label: 'fielded', x: landing.x, y: landing.y, z: 0, tSec: 2.8 });
  }
  return fallback;
}

function facingToHome(pos: { x: number; y: number }): number {
  return Math.atan2(-pos.y, -pos.x);
}

function buildDefenseFielders(teamColor: number): FielderEntity[] {
  return DEFENSE_POSITIONS.map((position, idx) => {
    const homePos = FIELDER_POSITIONS_FT[position];
    return {
      position,
      pos: { ...homePos },
      homePos: { ...homePos },
      state: { type: 'idle' },
      speedFps: 25,
      agility: 6,
      facingRad: facingToHome(homePos),
      turnRateRad: 6,
      throwVeloFps: 120,
      defense: 6,
      playerId: idx + 1,
      teamColor,
    };
  });
}

function eventForWaypoint(
  waypoint: PersistedBallPathWaypoint,
  outcome: string,
  row: PersistedGameEventRow,
): TickEvent[] {
  if (waypoint.label === 'landing') {
    return [{ type: 'ball-landed', at: { x: waypoint.x, y: waypoint.y } }];
  }
  if (waypoint.label === 'wall-hit') {
    if (outcome === 'home-run') {
      return [{ type: 'wall-cleared', at: { x: waypoint.x, y: waypoint.y }, heightFt: waypoint.z }];
    }
    return [{ type: 'wall-bounce', at: { x: waypoint.x, y: waypoint.y } }];
  }
  if (waypoint.label === 'fielded') {
    return [{ type: 'ball-fielded', by: zoneFielder(row.hit_zone), at: { x: waypoint.x, y: waypoint.y } }];
  }
  if (waypoint.label === 'rest') {
    return [{ type: 'ball-landed', at: { x: waypoint.x, y: waypoint.y } }];
  }
  return [];
}

function emptyGameState(
  row: PersistedGameEventRow,
  batterName: string,
  pitcherName: string,
  homeScore: number,
  awayScore: number,
  abIndex: number,
  baseState: PersistedBaseOccupancy,
) {
  return {
    inning: row.inning,
    half: row.half,
    outs: row.outs,
    homeScore,
    awayScore,
    basesOccupied: {
      first: baseState.first != null,
      second: baseState.second != null,
      third: baseState.third != null,
    },
    batter: batterName,
    pitcher: pitcherName,
    abIndex,
  };
}

export function buildPersistedSnapshots(payload: PersistedGamePayload): ReplayBuild {
  const events = [...(payload.events ?? [])].sort((a, b) => num(a.seq) - num(b.seq));
  const homeName = payload.teamMap[String(payload.game.home_team_id)] ?? 'Home';
  const awayName = payload.teamMap[String(payload.game.visitor_team_id)] ?? 'Visitor';

  const homeDefense = buildDefenseFielders(TEAM_COLOR.homeDefense);
  const awayDefense = buildDefenseFielders(TEAM_COLOR.awayDefense);

  if (events.length === 0) {
    return {
      snapshots: [{
        time: 0,
        ball: { pos: { x: 0, y: 61, z: 5 }, state: { type: 'idle' } },
        fielders: homeDefense,
        runners: [],
        events: [],
      }],
      totalDurationSec: 0,
    };
  }

  const snapshots: WorldSnapshot[] = [];
  let t = 0;
  let previousHomeRuns = 0;
  let previousVisitorRuns = 0;
  let previousInning = 0;
  let previousHalf: 'top' | 'bottom' | null = null;
  let previousAfter: PersistedBaseOccupancy = { first: null, second: null, third: null };

  for (let i = 0; i < events.length; i++) {
    const row = events[i];
    const outcome = mapOutcomeCode(num(row.outcome));
    const defense = row.half === 'top' ? homeDefense : awayDefense;
    const beforeBase = normalizeBaseOccupancy(row.base_occupancy_before) ?? previousAfter;
    const afterBase = normalizeBaseOccupancy(row.base_occupancy_after) ?? {
      first: beforeBase.first,
      second: beforeBase.second,
      third: beforeBase.third,
    };
    const batterName = row.batter_name || 'Batter';
    const pitcherName = row.pitcher_name || 'Pitcher';

    if (row.inning !== previousInning || row.half !== previousHalf) {
      snapshots.push({
        time: t,
        ball: { pos: { x: 0, y: 61, z: 5 }, state: { type: 'idle' } },
        fielders: defense,
        runners: [],
        events: [{ type: 'inning-change', inning: row.inning, half: row.half }],
        gameState: emptyGameState(
          row,
          batterName,
          pitcherName,
          previousHomeRuns,
          previousVisitorRuns,
          i,
          beforeBase,
        ),
      });
      t += 0.55;
    }

    const outsBefore = Math.max(0, num(row.outs) - (outcome === 'ground-out' || outcome === 'strikeout' ? 1 : 0));

    snapshots.push({
      time: t,
      ball: { pos: { x: 0, y: 61, z: 5 }, state: { type: 'idle' } },
      fielders: defense,
      runners: [],
      events: [{
        type: 'at-bat-start',
        batter: { name: batterName, hand: 'R', avg: 5, power: 5, eye: 5, speed: 5 },
        pitcher: { name: pitcherName, hand: 'R', ctrl: 5, stam: 5, throwing: 5 },
        inning: row.inning,
        half: row.half,
        outs: outsBefore,
        homeScore: previousHomeRuns,
        awayScore: previousVisitorRuns,
        homeName,
        awayName,
        bases: baseStateToArray(beforeBase),
      }],
      gameState: {
        ...emptyGameState(row, batterName, pitcherName, previousHomeRuns, previousVisitorRuns, i, beforeBase),
        outs: outsBefore,
      },
    });
    t += 0.7;

    if (isBattedBallOutcome(outcome)) {
      const waypoints = withFallbackWaypoints(row, outcome);
      const contact = waypoints.find((w) => w.label === 'contact') ?? { label: 'contact', x: 0, y: 0, z: 3, tSec: 0 };
      const landing = waypoints.find((w) => w.label === 'landing') ?? waypoints[waypoints.length - 1];
      const sprayAngle = row.spray_angle_deg != null ? num(row.spray_angle_deg) : 0;
      const launchAngle = row.launch_angle_deg != null
        ? num(row.launch_angle_deg)
        : (CONTACT_PROFILE[outcome]?.la ?? CONTACT_PROFILE['ground-out'].la);
      const exitVelo = row.exit_velo_mph != null
        ? num(row.exit_velo_mph)
        : (CONTACT_PROFILE[outcome]?.ev ?? CONTACT_PROFILE['ground-out'].ev);
      const hang = typeof landing?.tSec === 'number' ? Math.max(0.2, landing.tSec) : (launchAngle > 10 ? 3.2 : 1.2);
      const distanceFt = Math.round(Math.hypot(landing?.x ?? 0, landing?.y ?? 0));

      snapshots.push({
        time: t,
        ball: { pos: { x: contact.x, y: contact.y, z: contact.z }, state: { type: 'in-flight', vel: { x: 0, y: 0, z: 0 } } },
        fielders: defense,
        runners: [],
        events: [{
          type: 'contact',
          batterName,
          exitVeloMph: exitVelo,
          launchAngleDeg: launchAngle,
          sprayAngleDeg: sprayAngle,
          sprayDirection: sprayToDirection(sprayAngle),
          distanceFt,
          peakHeightFt: waypoints.find((w) => w.label === 'apex')?.z ?? (launchAngle > 10 ? 45 : 12),
          hangTimeSec: hang,
          isHomeRun: outcome === 'home-run',
        }],
        gameState: emptyGameState(row, batterName, pitcherName, previousHomeRuns, previousVisitorRuns, i, beforeBase),
      });
      t += 0.4;

      let prevT = contact.tSec ?? 0;
      for (const waypoint of waypoints) {
        if (waypoint.label === 'contact') continue;
        const dt = typeof waypoint.tSec === 'number' && waypoint.tSec >= prevT
          ? Math.max(0.2, waypoint.tSec - prevT)
          : 0.35;
        prevT = typeof waypoint.tSec === 'number' ? waypoint.tSec : prevT + dt;
        const isHeld = waypoint.label === 'fielded';
        snapshots.push({
          time: t,
          ball: {
            pos: { x: waypoint.x, y: waypoint.y, z: waypoint.z },
            state: isHeld
              ? { type: 'held', by: zoneFielder(row.hit_zone) }
              : { type: 'in-flight', vel: { x: 0, y: 0, z: 0 } },
          },
          fielders: defense,
          runners: [],
          events: eventForWaypoint(waypoint, outcome, row),
          gameState: emptyGameState(row, batterName, pitcherName, previousHomeRuns, previousVisitorRuns, i, beforeBase),
        });
        t += dt;
      }

      if (outcome === 'home-run') {
        snapshots.push({
          time: t,
          ball: { pos: { x: 0, y: 61, z: 8 }, state: { type: 'idle' } },
          fielders: defense,
          runners: [],
          events: [{ type: 'home-run', distanceFt }],
          gameState: emptyGameState(row, batterName, pitcherName, previousHomeRuns, previousVisitorRuns, i, beforeBase),
        });
        t += 0.35;
      }
    }

    const runsScored = Math.max(0, num(row.home_runs) - previousHomeRuns)
      + Math.max(0, num(row.visitor_runs) - previousVisitorRuns);
    const resultEvents: TickEvent[] = [];
    if (runsScored > 0) {
      for (let r = 0; r < runsScored; r++) {
        const label = row.runners_scored?.[r]?.trim();
        resultEvents.push({
          type: 'runner-scored',
          runnerId: 9000 + i * 10 + r,
          runnerName: label && label.toLowerCase() !== 'run scores' ? label : undefined,
        });
      }
    }

    resultEvents.push({
      type: 'at-bat-end',
      result: outcome,
      batterName,
      rbis: runsScored,
      fieldedBy: isBattedBallOutcome(outcome) && outcome !== 'home-run' ? zoneFielder(row.hit_zone) : undefined,
    });

    if (row.description) {
      resultEvents.push({
        type: 'manager-signal',
        decision: 'Persisted event',
        detail: row.description,
      });
    }

    snapshots.push({
      time: t,
      ball: { pos: { x: 0, y: 61, z: 5 }, state: { type: 'idle' } },
      fielders: defense,
      runners: [],
      events: resultEvents,
      gameState: emptyGameState(row, batterName, pitcherName, num(row.home_runs), num(row.visitor_runs), i, afterBase),
    });
    t += 0.55;

    snapshots.push({
      time: t,
      ball: { pos: { x: 0, y: 61, z: 5 }, state: { type: 'idle' } },
      fielders: defense,
      runners: [],
      events: [{ type: 'play-complete' }],
      gameState: emptyGameState(row, batterName, pitcherName, num(row.home_runs), num(row.visitor_runs), i, afterBase),
    });
    t += 0.85;

    previousAfter = afterBase;
    previousInning = row.inning;
    previousHalf = row.half;
    previousHomeRuns = num(row.home_runs);
    previousVisitorRuns = num(row.visitor_runs);
  }

  return {
    snapshots,
    totalDurationSec: snapshots[snapshots.length - 1]?.time ?? 0,
  };
}
