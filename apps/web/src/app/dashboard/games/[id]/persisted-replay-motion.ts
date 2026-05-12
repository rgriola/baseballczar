// Last touched by agent: 2026-05-07T22:45:00Z
// Purpose: Motion helpers for persisted replay runner, fielder, and ball snapshots.

import { sprintFtPerSec, type Position } from '@baseballczar/sim-engine';
import {
  BASE_ANCHORS,
  getRunnerOnBasePoint,
  type OccupiedBase,
} from '@baseballczar/tick-engine/fieldGeometry';
import type {
  FielderEntity,
  Point2D,
  RunnerEntity,
  WorldSnapshot,
} from '@baseballczar/tick-engine';

export type PersistedBaseOccupancyShape = {
  first: number | null;
  second: number | null;
  third: number | null;
};

export type PersistedBallWaypointShape = {
  label: string;
  x: number;
  y: number;
  z: number;
  tSec?: number;
};

type RunnerDestination = OccupiedBase | 'home';

const BASE_SORT_PRIORITY: Record<OccupiedBase, number> = {
  third: 0,
  second: 1,
  first: 2,
};

const BATTER_BOX_POS: Point2D = { x: -5, y: 0 };
export const SEGMENT_DT_SEC = 1 / 12;

export type RunnerMotionProfile = {
  speedFps: number;
  agility: number;
  turnRateRad: number;
};

export type RunnerProfileResolver = (runnerId: number) => RunnerMotionProfile | undefined;

export type ZoneFielderResolver = (
  zoneRaw: string | null,
  ballPos: Point2D,
  defenseFrame: FielderEntity[],
) => Position;

export function clamp01(value: number): number {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}

export function lerp(a: number, b: number, u: number): number {
  return a + (b - a) * u;
}

function clampSkill(value: number | null | undefined, fallback = 5): number {
  const raw = typeof value === 'number' && Number.isFinite(value) ? value : fallback;
  return Math.max(1, Math.min(10, Math.round(raw)));
}

function turnRateFromAgility(skill: number): number {
  return 4 + (skill - 1) * 0.35;
}

const DEFAULT_RUNNER_PROFILE: RunnerMotionProfile = {
  speedFps: sprintFtPerSec(5),
  agility: 5,
  turnRateRad: turnRateFromAgility(5),
};

function lerpPoint(a: Point2D, b: Point2D, u: number): Point2D {
  return {
    x: lerp(a.x, b.x, u),
    y: lerp(a.y, b.y, u),
  };
}

function moveTowardPoint(from: Point2D, to: Point2D, maxStepFt: number): Point2D {
  if (!Number.isFinite(maxStepFt) || maxStepFt <= 0) return { ...from };
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const dist = Math.hypot(dx, dy);
  if (dist <= maxStepFt || dist <= 1e-6) return { ...to };
  const u = maxStepFt / dist;
  return {
    x: from.x + dx * u,
    y: from.y + dy * u,
  };
}

export function cloneFielders(fielders: FielderEntity[]): FielderEntity[] {
  const homeAnchor = BASE_ANCHORS.home;
  return fielders.map((fielder) => ({
    ...fielder,
    pos: { ...fielder.pos },
    homePos: { ...fielder.homePos },
    facingRad: facingToPoint(fielder.pos, homeAnchor),
    state: { ...fielder.state } as FielderEntity['state'],
  }));
}

function facingToPoint(from: Point2D, to: Point2D): number {
  return Math.atan2(-(to.y - from.y), to.x - from.x);
}

function makeRunnerEntity(
  id: number,
  pos: Point2D,
  state: RunnerEntity['state'],
  resolveRunnerProfile?: RunnerProfileResolver,
  profileOverride?: RunnerMotionProfile,
): RunnerEntity {
  const homeAnchor = BASE_ANCHORS.home;
  const facingTarget = state.type === 'running' ? state.to : homeAnchor;
  const profile = profileOverride ?? resolveRunnerProfile?.(id) ?? DEFAULT_RUNNER_PROFILE;
  const agility = clampSkill(profile.agility, DEFAULT_RUNNER_PROFILE.agility);
  return {
    id,
    pos: { ...pos },
    state,
    speedFps: Math.max(1, profile.speedFps),
    agility,
    playIntelligence: 5,  // persisted replays don't need PI for decisions
    facingRad: facingToPoint(pos, facingTarget),
    turnRateRad: Number.isFinite(profile.turnRateRad) && profile.turnRateRad > 0
      ? profile.turnRateRad
      : turnRateFromAgility(agility),
  };
}

function baseAnchorPoint(base: RunnerDestination): Point2D {
  const anchor = BASE_ANCHORS[base];
  return { x: anchor.x, y: anchor.y };
}

function nextBaseOnPath(base: RunnerDestination): RunnerDestination {
  if (base === 'home') return 'first';
  if (base === 'first') return 'second';
  if (base === 'second') return 'third';
  return 'home';
}

function baseAnchorRoute(start: RunnerDestination, destination: RunnerDestination): Point2D[] {
  const points: Point2D[] = [baseAnchorPoint(start)];
  let cursor = start;
  let guard = 0;

  while (cursor !== destination && guard < 4) {
    cursor = nextBaseOnPath(cursor);
    points.push(baseAnchorPoint(cursor));
    guard += 1;
  }

  return points;
}

function runnerHoldPoint(base: OccupiedBase): Point2D {
  const point = getRunnerOnBasePoint(base);
  return { x: point.x, y: point.y };
}

function baseEntries(baseState: PersistedBaseOccupancyShape): Array<{ base: OccupiedBase; runnerId: number }> {
  const out: Array<{ base: OccupiedBase; runnerId: number }> = [];
  if (typeof baseState.first === 'number' && Number.isFinite(baseState.first)) {
    out.push({ base: 'first', runnerId: baseState.first });
  }
  if (typeof baseState.second === 'number' && Number.isFinite(baseState.second)) {
    out.push({ base: 'second', runnerId: baseState.second });
  }
  if (typeof baseState.third === 'number' && Number.isFinite(baseState.third)) {
    out.push({ base: 'third', runnerId: baseState.third });
  }
  return out;
}

export function buildBaseRunners(
  baseState: PersistedBaseOccupancyShape,
  resolveRunnerProfile?: RunnerProfileResolver,
): RunnerEntity[] {
  return baseEntries(baseState).map(({ base, runnerId }) => (
    makeRunnerEntity(runnerId, runnerHoldPoint(base), { type: 'on-base', base }, resolveRunnerProfile)
  ));
}

function makeBatterStandRunner(
  id: number,
  resolveRunnerProfile?: RunnerProfileResolver,
  batterProfile?: RunnerMotionProfile,
): RunnerEntity {
  return makeRunnerEntity(
    id,
    BATTER_BOX_POS,
    { type: 'on-base', base: 'first' },
    resolveRunnerProfile,
    batterProfile,
  );
}

function isOutLikeOutcome(outcome: string): boolean {
  return outcome === 'ground-out'
    || outcome === 'strikeout'
    || outcome === 'fly-out'
    || outcome === 'line-out'
    || outcome === 'pop-out'
    || outcome === 'foul-out'
    || outcome === 'double-play'
    || outcome === 'sac-fly'
    || outcome === 'fielders-choice';
}

function batterDestination(outcome: string): RunnerDestination {
  if (outcome === 'double') return 'second';
  if (outcome === 'triple') return 'third';
  if (outcome === 'home-run') return 'home';
  return 'first';
}

function pathForDestination(dest: RunnerDestination): Point2D[] {
  const route = baseAnchorRoute('home', dest);
  return [BATTER_BOX_POS, ...route.slice(1)];
}

function pathFromOccupiedBase(base: OccupiedBase, destination: RunnerDestination): Point2D[] {
  const route = baseAnchorRoute(base, destination);
  return [runnerHoldPoint(base), ...route.slice(1)];
}

function interpolateRunnerPath(path: Point2D[], progress: number): { pos: Point2D; from: Point2D; to: Point2D } {
  if (path.length <= 1) {
    const single = path[0] ?? baseAnchorPoint('home');
    return { pos: { ...single }, from: { ...single }, to: { ...single } };
  }

  const segCount = path.length - 1;
  const scaled = clamp01(progress) * segCount;
  const segIdx = Math.min(segCount - 1, Math.floor(scaled));
  const localU = scaled - segIdx;
  const from = path[segIdx];
  const to = path[segIdx + 1];
  return {
    pos: lerpPoint(from, to, localU),
    from: { ...from },
    to: { ...to },
  };
}

export function buildAtBatStartRunners(
  beforeBase: PersistedBaseOccupancyShape,
  batterRunnerId: number,
  resolveRunnerProfile?: RunnerProfileResolver,
  batterRunnerProfile?: RunnerMotionProfile,
): RunnerEntity[] {
  return [
    ...buildBaseRunners(beforeBase, resolveRunnerProfile),
    makeBatterStandRunner(batterRunnerId, resolveRunnerProfile, batterRunnerProfile),
  ];
}

export function buildPlayRunners(
  beforeBase: PersistedBaseOccupancyShape,
  afterBase: PersistedBaseOccupancyShape,
  outcome: string,
  progress: number,
  runsScored: number,
  batterRunnerId: number,
  resolveRunnerProfile?: RunnerProfileResolver,
  batterRunnerProfile?: RunnerMotionProfile,
): RunnerEntity[] {
  const u = clamp01(progress);
  const runners: RunnerEntity[] = [];
  const batterOut = isOutLikeOutcome(outcome);
  const batterDest = batterDestination(outcome);
  let batterIdentityId = batterRunnerId;

  const afterById = new Map<number, OccupiedBase>();
  for (const entry of baseEntries(afterBase)) {
    afterById.set(entry.runnerId, entry.base);
  }

  const unmatchedBefore: Array<{ base: OccupiedBase; runnerId: number }> = [];

  for (const entry of baseEntries(beforeBase)) {
    const nextBase = afterById.get(entry.runnerId);
    if (nextBase) {
      if (nextBase === entry.base) {
        runners.push(
          makeRunnerEntity(entry.runnerId, runnerHoldPoint(entry.base), {
            type: 'on-base',
            base: entry.base,
          }, resolveRunnerProfile),
        );
      } else {
        const path = pathFromOccupiedBase(entry.base, nextBase);
        const step = interpolateRunnerPath(path, u);
        runners.push(
          makeRunnerEntity(entry.runnerId, step.pos, {
            type: 'running',
            from: step.from,
            to: step.to,
          }, resolveRunnerProfile),
        );
      }
      afterById.delete(entry.runnerId);
    } else {
      unmatchedBefore.push(entry);
    }
  }

  let scoringRemaining = Math.max(0, runsScored);
  unmatchedBefore.sort((a, b) => BASE_SORT_PRIORITY[a.base] - BASE_SORT_PRIORITY[b.base]);
  for (const entry of unmatchedBefore) {
    if (scoringRemaining > 0) {
      const path = pathFromOccupiedBase(entry.base, 'home');
      const step = interpolateRunnerPath(path, u);
      runners.push(
        makeRunnerEntity(entry.runnerId, step.pos, {
          type: 'running',
          from: step.from,
          to: step.to,
        }, resolveRunnerProfile),
      );
      scoringRemaining -= 1;
      continue;
    }

    if (u < 0.9) {
      runners.push(
        makeRunnerEntity(entry.runnerId, runnerHoldPoint(entry.base), {
          type: 'on-base',
          base: entry.base,
        }, resolveRunnerProfile),
      );
    }
  }

  const batterSafeByAfterState = batterDest !== 'home'
    && Array.from(afterById.values()).some((base) => base === batterDest);
  const batterSafe = !batterOut || batterSafeByAfterState;

  // Persisted after-base occupancy usually carries the real batter ID when safe.
  // Reuse it so we don't render a synthetic batter plus a real batter at once.
  if (batterSafe && batterDest !== 'home') {
    let batterCandidateId: number | null = null;

    for (const [runnerId, targetBase] of afterById.entries()) {
      if (targetBase === batterDest) {
        batterCandidateId = runnerId;
        break;
      }
    }

    if (batterCandidateId === null && afterById.size === 1) {
      const only = afterById.keys().next();
      if (!only.done) batterCandidateId = only.value;
    }

    if (batterCandidateId !== null) {
      batterIdentityId = batterCandidateId;
      afterById.delete(batterCandidateId);
    }
  }

  for (const [runnerId, targetBase] of afterById.entries()) {
    const fromBase: RunnerDestination = targetBase === 'first'
      ? 'home'
      : targetBase === 'second'
        ? 'first'
        : 'second';
    const path = baseAnchorRoute(fromBase, targetBase);
    const step = interpolateRunnerPath(path, u);

    let state: RunnerEntity['state'];
    let pos: Point2D;
    if (u >= 0.98) {
      state = { type: 'on-base', base: targetBase };
      pos = runnerHoldPoint(targetBase);
    } else {
      state = { type: 'running', from: step.from, to: step.to };
      pos = step.pos;
    }

    runners.push(
      makeRunnerEntity(runnerId, pos, state, resolveRunnerProfile),
    );
  }

  const batterPath = pathForDestination(batterDest);
  const batterStep = interpolateRunnerPath(batterPath, u);
  if (!(batterOut && !batterSafe && u >= 0.92)) {
    let batterPos = batterStep.pos;
    const batterState: RunnerEntity['state'] = u >= 0.98
      ? batterDest === 'home'
        ? { type: 'scored' }
        : batterOut && !batterSafe
          ? { type: 'running', from: batterStep.from, to: batterStep.to }
          : { type: 'on-base', base: batterDest }
      : { type: 'running', from: batterStep.from, to: batterStep.to };

    if (batterState.type === 'on-base') {
      batterPos = runnerHoldPoint(batterState.base);
    }
    if (batterState.type === 'scored') {
      batterPos = baseAnchorPoint('home');
    }

    const batterProfile = batterIdentityId === batterRunnerId
      ? batterRunnerProfile
      : undefined;
    runners.push(makeRunnerEntity(batterIdentityId, batterPos, batterState, resolveRunnerProfile, batterProfile));
  }

  const deduped = new Map<number, RunnerEntity>();
  for (const runner of runners) {
    deduped.set(runner.id, runner);
  }

  return Array.from(deduped.values());
}

export function buildDefenseFrameForBall(
  defenseTemplate: FielderEntity[],
  hitZone: string | null,
  ballPos: Point2D,
  heldByBall: boolean,
  resolveZoneFielder: ZoneFielderResolver,
  previousFrame?: FielderEntity[],
  deltaSec = SEGMENT_DT_SEC,
): FielderEntity[] {
  const frame = cloneFielders(previousFrame && previousFrame.length > 0 ? previousFrame : defenseTemplate);
  const homeAnchor = BASE_ANCHORS.home;

  // Keep the baseline facing stable: defense triangles point toward home plate.
  for (const fielder of frame) {
    fielder.facingRad = facingToPoint(fielder.pos, homeAnchor);
  }

  const primaryPos = resolveZoneFielder(hitZone, ballPos, frame);
  const primary = frame.find((f) => f.position === primaryPos);
  const safeDt = Math.max(0, deltaSec);

  if (primary) {
    const maxStepFt = Math.max(0, primary.speedFps) * safeDt;
    primary.pos = moveTowardPoint(primary.pos, ballPos, maxStepFt);
    primary.state = heldByBall
      ? { type: 'has-ball', decideSec: 0.2 }
      : { type: 'tracking', target: { ...ballPos } };
    primary.facingRad = facingToPoint(primary.pos, homeAnchor);
  }

  const centerFielder = frame.find((f) => f.position === 'CF');
  if (centerFielder && centerFielder.position !== primaryPos) {
    const backupStepFt = Math.max(0, centerFielder.speedFps * 0.65) * safeDt;
    centerFielder.pos = moveTowardPoint(centerFielder.pos, ballPos, backupStepFt);
    centerFielder.state = { type: 'backing-up', target: { ...ballPos } };
    centerFielder.facingRad = facingToPoint(centerFielder.pos, homeAnchor);
  }

  return frame;
}

export function buildBallState(
  from: PersistedBallWaypointShape,
  to: PersistedBallWaypointShape,
  segmentDurationSec: number,
  progress: number,
  hitZone: string | null,
  resolveZoneFielder: ZoneFielderResolver,
  defenseFrame: FielderEntity[],
): WorldSnapshot['ball']['state'] {
  if (to.label === 'fielded' && progress >= 0.999) {
    return {
      type: 'held',
      by: resolveZoneFielder(hitZone, { x: to.x, y: to.y }, defenseFrame),
    };
  }

  const safeDt = Math.max(segmentDurationSec, 0.01);
  const vx = (to.x - from.x) / safeDt;
  const vy = (to.y - from.y) / safeDt;
  const vz = (to.z - from.z) / safeDt;

  const zNow = lerp(from.z, to.z, progress);
  if (zNow <= 0.3 && to.label !== 'wall-hit') {
    return { type: 'rolling', vel: { x: vx, y: vy } };
  }

  return { type: 'in-flight', vel: { x: vx, y: vy, z: vz } };
}
