// Last touched by agent: 2026-05-07T22:40:33Z
// Purpose: Builds persisted replay snapshots directly from stored game telemetry.

import { type Position } from '@baseballczar/sim-engine';
import type {
  TickEvent,
  WorldSnapshot,
} from '@baseballczar/tick-engine';
import {
  SEGMENT_DT_SEC,
  buildAtBatStartRunners,
  buildBallState,
  buildBaseRunners,
  buildDefenseFrameForBall,
  buildPlayRunners,
  clamp01,
  cloneFielders,
  lerp,
  type PersistedBaseOccupancyShape,
  type PersistedBallWaypointShape,
} from './persisted-replay-motion';
import { buildGroundOutThrowSequence } from './persisted-replay-defense';
import {
  isBattedBallOutcome,
  isCatchOutOutcome,
  mapPersistedOutcomeCode,
  normalizeOutcomeFromDescription,
} from './persisted-replay-outcome';
import { withCatchOutWaypoints } from './persisted-replay-waypoint-transforms';
import { buildDefenseFieldersFromRows, buildPlayerNameSummaryResolver, buildRunnerNameResolver, buildRunnerSkillResolver, type ReplayPlayerSummary } from './persisted-replay-defense-roster';

export type PersistedBallPathWaypoint = PersistedBallWaypointShape;

export type PersistedBaseOccupancy = PersistedBaseOccupancyShape;

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
  hand_batting?: number | null;
  hand_throw?: number | null;
  speed?: number | null;
  stamina?: number | null;
  ag?: number | null;
  eye?: number | null;
  avg?: number | null;
  strength?: number | null;
  play_intel?: number | null;
  bunting?: number | null;
  fielding?: number | null;
  throw?: number | null;
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

const TEAM_COLOR = {
  homeDefense: 0x1e5631,
  awayDefense: 0x2a3a6e,
} as const;

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

const PITCH_TYPES = ['Four-seam', 'Sinker', 'Slider', 'Changeup', 'Curveball'] as const;

type SyntheticPitchOutcome = 'ball' | 'called-strike' | 'swinging-strike' | 'foul' | 'in-play';
type SyntheticPitchStep = {
  outcome: SyntheticPitchOutcome;
  zone: 'in' | 'edge' | 'off';
  actualInZone: boolean;
  swung: boolean;
};

export function num(v: unknown, fallback = 0): number {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const parsed = Number(v);
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
}

function clampSkill(value: number | null | undefined, fallback = 5): number {
  return Math.max(1, Math.min(10, Math.round(typeof value === 'number' && Number.isFinite(value) ? value : fallback)));
}

function handLabel(handCode: number | null | undefined): 'R' | 'L' | 'S' { return handCode === 2 ? 'L' : handCode === 3 ? 'S' : 'R'; }

function buildSyntheticPitchPlan(seq: number, outcome: string): SyntheticPitchStep[] {
  if (outcome === 'walk') {
    return [
      { outcome: 'ball', zone: 'off', actualInZone: false, swung: false },
      { outcome: 'called-strike', zone: 'edge', actualInZone: true, swung: false },
      { outcome: 'ball', zone: 'off', actualInZone: false, swung: false },
      { outcome: 'ball', zone: 'off', actualInZone: false, swung: false },
      { outcome: 'ball', zone: 'off', actualInZone: false, swung: false },
    ];
  }

  if (outcome === 'strikeout') {
    if (seq % 2 === 0) {
      return [
        { outcome: 'called-strike', zone: 'edge', actualInZone: true, swung: false },
        { outcome: 'foul', zone: 'in', actualInZone: true, swung: true },
        { outcome: 'swinging-strike', zone: 'off', actualInZone: false, swung: true },
      ];
    }

    return [
      { outcome: 'ball', zone: 'off', actualInZone: false, swung: false },
      { outcome: 'called-strike', zone: 'in', actualInZone: true, swung: false },
      { outcome: 'swinging-strike', zone: 'edge', actualInZone: true, swung: true },
      { outcome: 'swinging-strike', zone: 'off', actualInZone: false, swung: true },
    ];
  }

  if (isBattedBallOutcome(outcome)) {
    if (seq % 2 === 0) {
      return [
        { outcome: 'called-strike', zone: 'in', actualInZone: true, swung: false },
        { outcome: 'ball', zone: 'off', actualInZone: false, swung: false },
        { outcome: 'in-play', zone: 'edge', actualInZone: true, swung: true },
      ];
    }

    return [
      { outcome: 'ball', zone: 'off', actualInZone: false, swung: false },
      { outcome: 'called-strike', zone: 'edge', actualInZone: true, swung: false },
      { outcome: 'foul', zone: 'in', actualInZone: true, swung: true },
      { outcome: 'in-play', zone: 'in', actualInZone: true, swung: true },
    ];
  }

  return [
    { outcome: 'called-strike', zone: 'edge', actualInZone: true, swung: false },
    { outcome: 'in-play', zone: 'in', actualInZone: true, swung: true },
  ];
}

function syntheticPitchMph(seq: number, pitchIndex: number, zone: 'in' | 'edge' | 'off'): number {
  const seed = (seq * 7 + pitchIndex * 5) % 8;
  const base = 88 + seed;
  if (zone === 'off') return base - 2;
  if (zone === 'edge') return base - 1;
  return base;
}

function buildSyntheticPitchEvents(
  row: PersistedGameEventRow,
  outcome: string,
  batterName: string,
  pitcherName: string,
): TickEvent[][] {
  const plan = buildSyntheticPitchPlan(num(row.seq), outcome);
  let balls = 0;
  let strikes = 0;

  return plan.map((step, index) => {
    if (step.outcome === 'ball') {
      balls = Math.min(4, balls + 1);
    } else if (step.outcome === 'called-strike' || step.outcome === 'swinging-strike') {
      strikes = Math.min(3, strikes + 1);
    } else if (step.outcome === 'foul') {
      strikes = Math.min(2, strikes + 1);
    }

    const pitch: TickEvent = {
      type: 'pitch',
      pitchNum: index + 1,
      batterName,
      pitcherName,
      zone: step.zone,
      actualInZone: step.actualInZone,
      speed: PITCH_TYPES[(num(row.seq) + index) % PITCH_TYPES.length],
      mph: syntheticPitchMph(num(row.seq), index, step.zone),
      swung: step.swung,
    };

    const pitchResult: TickEvent = {
      type: 'pitch-result',
      outcome: step.outcome,
      balls,
      strikes,
      batterName,
      pitcherName,
    };

    return [pitch, pitchResult];
  });
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

function estimateApexHeightFt(launchAngleDeg: number, exitVeloMph: number, contactHeightFt: number): number {
  const gFps2 = 32.174;
  const clampedLa = Math.max(-25, Math.min(60, launchAngleDeg));
  if (clampedLa <= 0) return Math.max(0, contactHeightFt);
  const launchRad = (clampedLa * Math.PI) / 180;
  const veloFps = Math.max(40, exitVeloMph * 1.46667);
  const verticalVelo = veloFps * Math.sin(launchRad);
  const ballisticRise = (verticalVelo * verticalVelo) / (2 * gFps2);
  return Math.max(contactHeightFt, Math.min(110, contactHeightFt + ballisticRise));
}

function withSynthesizedApex(
  row: PersistedGameEventRow,
  outcome: string,
  waypoints: PersistedBallPathWaypoint[],
): PersistedBallPathWaypoint[] {
  if (!isBattedBallOutcome(outcome)) return waypoints;
  if (waypoints.some((w) => w.label === 'apex' || w.label === 'wall-hit')) return waypoints;
  const contact = waypoints.find((w) => w.label === 'contact');
  const landing = waypoints.find((w) => w.label === 'landing');
  if (!contact || !landing) return waypoints;
  const maxZ = waypoints.reduce((currentMax, waypoint) => Math.max(currentMax, waypoint.z), Number.NEGATIVE_INFINITY);
  const launchAngle = row.launch_angle_deg != null
    ? num(row.launch_angle_deg)
    : (CONTACT_PROFILE[outcome]?.la ?? CONTACT_PROFILE['ground-out'].la);
  const exitVelo = row.exit_velo_mph != null
    ? num(row.exit_velo_mph)
    : (CONTACT_PROFILE[outcome]?.ev ?? CONTACT_PROFILE['ground-out'].ev);
  const apexZ = estimateApexHeightFt(launchAngle, exitVelo, contact.z);
  if (!Number.isFinite(maxZ) || apexZ <= maxZ + 0.75) {
    return waypoints;
  }
  const contactTime = typeof contact.tSec === 'number' ? contact.tSec : 0;
  const landingTime = typeof landing.tSec === 'number' ? landing.tSec : undefined;
  const apexTime = typeof landingTime === 'number'
    ? contactTime + Math.max(0.18, (landingTime - contactTime) * 0.45)
    : undefined;

  const apexWaypoint: PersistedBallPathWaypoint = {
    label: 'apex',
    x: lerp(contact.x, landing.x, 0.42),
    y: lerp(contact.y, landing.y, 0.42),
    z: apexZ,
    ...(typeof apexTime === 'number' ? { tSec: apexTime } : {}),
  };

  const landingIdx = waypoints.findIndex((w) => w.label === 'landing');
  if (landingIdx < 0) return waypoints;

  const enriched = [...waypoints];
  enriched.splice(landingIdx, 0, apexWaypoint);
  return enriched;
}

function withFallbackWaypoints(row: PersistedGameEventRow, outcome: string): PersistedBallPathWaypoint[] {
  const existing = normalizeWaypoints(row.ball_path_waypoints);
  if (existing.length > 0) {
    return withCatchOutWaypoints(outcome, withSynthesizedApex(row, outcome, existing));
  }

  const landing = zonePointFt(row.hit_zone);
  const fallback: PersistedBallPathWaypoint[] = [
    { label: 'contact', x: 0, y: 0, z: 3, tSec: 0 },
    { label: 'landing', x: landing.x, y: landing.y, z: 0, tSec: outcome === 'ground-out' ? 1.1 : 2.4 },
  ];

  if (outcome !== 'home-run') {
    fallback.push({ label: 'fielded', x: landing.x, y: landing.y, z: 0, tSec: 2.8 });
  }
  return withCatchOutWaypoints(outcome, withSynthesizedApex(row, outcome, fallback));
}

function eventForWaypoint(
  waypoint: PersistedBallPathWaypoint,
  outcome: string,
  row: PersistedGameEventRow,
  previousWaypoint?: PersistedBallPathWaypoint,
): TickEvent[] {
  if (waypoint.label === 'landing') {
    if (isCatchOutOutcome(outcome)) return [];
    const previousWasGrounded = previousWaypoint?.label === 'landing' || previousWaypoint?.label === 'rest';
    const sameSpotAsPrevious = previousWaypoint
      ? Math.hypot(waypoint.x - previousWaypoint.x, waypoint.y - previousWaypoint.y) < 1
      : false;
    if (previousWasGrounded && sameSpotAsPrevious) return [];
    return [{ type: 'ball-landed', at: { x: waypoint.x, y: waypoint.y } }];
  }
  if (waypoint.label === 'wall-hit') {
    if (outcome === 'home-run') {
      return [{ type: 'wall-cleared', at: { x: waypoint.x, y: waypoint.y }, heightFt: waypoint.z }];
    }
    return [{ type: 'wall-bounce', at: { x: waypoint.x, y: waypoint.y } }];
  }
  if (waypoint.label === 'fielded') {
    if (isCatchOutOutcome(outcome)) {
      return [{ type: 'ball-caught', by: zoneFielder(row.hit_zone), at: { x: waypoint.x, y: waypoint.y } }];
    }
    return [{ type: 'ball-fielded', by: zoneFielder(row.hit_zone), at: { x: waypoint.x, y: waypoint.y } }];
  }
  if (waypoint.label === 'rest') {
    return [];
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

  const homeDefense = buildDefenseFieldersFromRows(
    TEAM_COLOR.homeDefense,
    payload.game.home_team_id,
    payload.hitting ?? [],
    payload.pitching ?? [],
  );
  const awayDefense = buildDefenseFieldersFromRows(
    TEAM_COLOR.awayDefense,
    payload.game.visitor_team_id,
    payload.hitting ?? [],
    payload.pitching ?? [],
  );
  const resolveRunnerProfile = buildRunnerSkillResolver(payload.hitting ?? [], payload.pitching ?? []);
  const resolveRunnerProfileByName = buildRunnerNameResolver(payload.hitting ?? [], payload.pitching ?? []);
  const resolvePlayerSummaryByName = buildPlayerNameSummaryResolver(payload.hitting ?? [], payload.pitching ?? []);

  if (events.length === 0) {
    return {
      snapshots: [{
        time: 0,
        ball: { pos: { x: 0, y: 61, z: 5 }, state: { type: 'idle' } },
        fielders: cloneFielders(homeDefense),
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
  let previousOuts = 0;
  let previousAfter: PersistedBaseOccupancy = { first: null, second: null, third: null };

  for (let i = 0; i < events.length; i++) {
    const row = events[i];
    const mappedOutcome = mapPersistedOutcomeCode(num(row.outcome));
    const outcome = normalizeOutcomeFromDescription(mappedOutcome, row.description);
    const defense = row.half === 'top' ? homeDefense : awayDefense;
    const beforeBase = normalizeBaseOccupancy(row.base_occupancy_before) ?? previousAfter;
    const afterBase = normalizeBaseOccupancy(row.base_occupancy_after) ?? {
      first: beforeBase.first,
      second: beforeBase.second,
      third: beforeBase.third,
    };
    const batterName = row.batter_name || 'Batter';
    const pitcherName = row.pitcher_name || 'Pitcher';
    const batterSummary: ReplayPlayerSummary | undefined = resolvePlayerSummaryByName(batterName);
    const pitcherSummary: ReplayPlayerSummary | undefined = resolvePlayerSummaryByName(pitcherName);
    const batterRunnerId = 9_000_000 + num(row.seq, i + 1);
    const batterRunnerProfile = resolveRunnerProfileByName(batterName);
    const runsScored = Math.max(0, num(row.home_runs) - previousHomeRuns)
      + Math.max(0, num(row.visitor_runs) - previousVisitorRuns);

    if (row.inning !== previousInning || row.half !== previousHalf) {
      snapshots.push({
        time: t,
        ball: { pos: { x: 0, y: 61, z: 5 }, state: { type: 'idle' } },
        fielders: cloneFielders(defense),
        runners: buildBaseRunners(beforeBase, resolveRunnerProfile),
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

    const outsBefore = row.inning === previousInning && row.half === previousHalf
      ? Math.max(0, Math.min(2, previousOuts))
      : 0;

    snapshots.push({
      time: t,
      ball: { pos: { x: 0, y: 61, z: 5 }, state: { type: 'idle' } },
      fielders: cloneFielders(defense),
      runners: buildAtBatStartRunners(beforeBase, batterRunnerId, resolveRunnerProfile, batterRunnerProfile),
      events: [{
        type: 'at-bat-start',
        batter: { name: batterName, hand: handLabel(batterSummary?.hand_batting), avg: clampSkill(batterSummary?.avg, 5), power: clampSkill(batterSummary?.strength, 5), eye: clampSkill(batterSummary?.eye, 5), speed: clampSkill(batterSummary?.speed, 5) },
        pitcher: { name: pitcherName, hand: handLabel(pitcherSummary?.hand_throw), ctrl: clampSkill(pitcherSummary?.eye, 5), stam: clampSkill(pitcherSummary?.stamina, 5), throwing: clampSkill(pitcherSummary?.throw, 5) },
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
    t += 0.22;

    const syntheticPitchFrames = buildSyntheticPitchEvents(row, outcome, batterName, pitcherName);
    for (const pitchEvents of syntheticPitchFrames) {
      snapshots.push({
        time: t,
        ball: { pos: { x: 0, y: 61, z: 5 }, state: { type: 'idle' } },
        fielders: cloneFielders(defense),
        runners: buildAtBatStartRunners(beforeBase, batterRunnerId, resolveRunnerProfile, batterRunnerProfile),
        events: pitchEvents,
        gameState: {
          ...emptyGameState(row, batterName, pitcherName, previousHomeRuns, previousVisitorRuns, i, beforeBase),
          outs: outsBefore,
        },
      });
      t += 0.2;
    }

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
      const totalPlaySec = Math.max(
        0.8,
        typeof waypoints[waypoints.length - 1]?.tSec === 'number'
          ? num(waypoints[waypoints.length - 1]?.tSec, 0.8)
          : outcome === 'ground-out' ? 2.2 : 3.2,
      );
      let elapsedPlaySec = 0;
      let defenseFrame = buildDefenseFrameForBall(defense, row.hit_zone, { x: contact.x, y: contact.y }, false, zoneFielder, undefined, 0);

      snapshots.push({
        time: t,
        ball: { pos: { x: contact.x, y: contact.y, z: contact.z }, state: { type: 'in-flight', vel: { x: 0, y: 0, z: 0 } } },
        fielders: defenseFrame,
        runners: buildPlayRunners(beforeBase, afterBase, outcome, 0, runsScored, batterRunnerId, resolveRunnerProfile, batterRunnerProfile),
        events: [{
          type: 'contact',
          batterName,
          exitVeloMph: exitVelo,
          launchAngleDeg: launchAngle,
          sprayAngleDeg: sprayAngle,
          sprayDirection: sprayToDirection(sprayAngle),
          distanceFt,
          peakHeightFt: waypoints.find((w) => w.label === 'apex')?.z ?? estimateApexHeightFt(launchAngle, exitVelo, contact.z),
          hangTimeSec: hang,
          isHomeRun: outcome === 'home-run',
        }],
        gameState: emptyGameState(row, batterName, pitcherName, previousHomeRuns, previousVisitorRuns, i, beforeBase),
      });
      t += 0.4;

      let prevT = contact.tSec ?? 0;
      let prevWaypoint = contact;
      for (const waypoint of waypoints) {
        if (waypoint.label === 'contact') continue;
        const segmentDuration = typeof waypoint.tSec === 'number' && waypoint.tSec >= prevT
          ? Math.max(0.2, waypoint.tSec - prevT)
          : 0.35;
        const steps = Math.max(1, Math.ceil(segmentDuration / SEGMENT_DT_SEC));
        const stepDuration = segmentDuration / steps;

        for (let step = 1; step <= steps; step++) {
          const segU = step / steps;
          const x = lerp(prevWaypoint.x, waypoint.x, segU);
          const y = lerp(prevWaypoint.y, waypoint.y, segU);
          const z = lerp(prevWaypoint.z, waypoint.z, segU);
          elapsedPlaySec += stepDuration;
          const playU = clamp01(elapsedPlaySec / totalPlaySec);
          const lastStep = step === steps;
          const heldByBall = waypoint.label === 'fielded' && lastStep;
          defenseFrame = buildDefenseFrameForBall(defense, row.hit_zone, { x, y }, heldByBall, zoneFielder, defenseFrame, stepDuration);

          snapshots.push({
            time: t,
            ball: {
              pos: { x, y, z },
              state: buildBallState(prevWaypoint, waypoint, segmentDuration, segU, row.hit_zone, zoneFielder),
            },
            fielders: defenseFrame,
            runners: buildPlayRunners(beforeBase, afterBase, outcome, playU, runsScored, batterRunnerId, resolveRunnerProfile, batterRunnerProfile),
            events: lastStep ? eventForWaypoint(waypoint, outcome, row, prevWaypoint) : [],
            gameState: emptyGameState(row, batterName, pitcherName, previousHomeRuns, previousVisitorRuns, i, beforeBase),
          });
          t += stepDuration;
        }

        prevWaypoint = waypoint;
        prevT = typeof waypoint.tSec === 'number' ? waypoint.tSec : prevT + segmentDuration;
      }

      if (outcome === 'ground-out') {
        const throwFrames = buildGroundOutThrowSequence({
          defense,
          throwerPos: zoneFielder(row.hit_zone),
          waypoints,
          fallbackStart: contact,
          beforeBase,
          afterBase,
          runsScored,
          batterRunnerId,
          batterName,
          resolveRunnerProfile,
          batterRunnerProfile,
          startTimeSec: t,
          gameState: emptyGameState(row, batterName, pitcherName, previousHomeRuns, previousVisitorRuns, i, beforeBase),
        });
        snapshots.push(...throwFrames.snapshots);
        t = throwFrames.endTimeSec;
      }

      if (outcome === 'home-run') {
        snapshots.push({
          time: t,
          ball: { pos: { x: 0, y: 61, z: 8 }, state: { type: 'idle' } },
          fielders: cloneFielders(defense),
          runners: buildPlayRunners(beforeBase, afterBase, outcome, 1, runsScored, batterRunnerId, resolveRunnerProfile, batterRunnerProfile),
          events: [{ type: 'home-run', distanceFt }],
          gameState: emptyGameState(row, batterName, pitcherName, previousHomeRuns, previousVisitorRuns, i, beforeBase),
        });
        t += 0.35;
      }
    }
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
      fielders: cloneFielders(defense),
      runners: buildBaseRunners(afterBase, resolveRunnerProfile),
      events: resultEvents,
      gameState: emptyGameState(row, batterName, pitcherName, num(row.home_runs), num(row.visitor_runs), i, afterBase),
    });
    t += 0.55;

    snapshots.push({
      time: t,
      ball: { pos: { x: 0, y: 61, z: 5 }, state: { type: 'idle' } },
      fielders: cloneFielders(defense),
      runners: buildBaseRunners(afterBase, resolveRunnerProfile),
      events: [{ type: 'play-complete' }],
      gameState: emptyGameState(row, batterName, pitcherName, num(row.home_runs), num(row.visitor_runs), i, afterBase),
    });
    t += 0.85;

    previousAfter = afterBase;
    previousInning = row.inning;
    previousHalf = row.half;
    previousOuts = Math.max(0, num(row.outs));
    previousHomeRuns = num(row.home_runs);
    previousVisitorRuns = num(row.visitor_runs);
  }

  return {
    snapshots,
    totalDurationSec: snapshots[snapshots.length - 1]?.time ?? 0,
  };
}
