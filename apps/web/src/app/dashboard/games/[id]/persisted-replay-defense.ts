// Last touched by agent: 2026-05-07T22:40:33Z
// Purpose: Builds synthesized defensive throw ticks for persisted ground-out plays.

import { type Position } from '@baseballczar/sim-engine';
import { getBaseAnchor } from '@baseballczar/tick-engine/fieldGeometry';
import type {
  FielderEntity,
  TickEvent,
  WorldSnapshot,
} from '@baseballczar/tick-engine';
import {
  SEGMENT_DT_SEC,
  buildBaseRunners,
  buildPlayRunners,
  cloneFielders,
  lerp,
  type RunnerMotionProfile,
  type RunnerProfileResolver,
  type PersistedBallWaypointShape,
  type PersistedBaseOccupancyShape,
} from './persisted-replay-motion';

type GroundOutThrowSequenceInput = {
  defense: FielderEntity[];
  throwerPos: Position;
  waypoints: PersistedBallWaypointShape[];
  fallbackStart: PersistedBallWaypointShape;
  beforeBase: PersistedBaseOccupancyShape;
  afterBase: PersistedBaseOccupancyShape;
  runsScored: number;
  batterRunnerId: number;
  batterName: string;
  resolveRunnerProfile?: RunnerProfileResolver;
  batterRunnerProfile?: RunnerMotionProfile;
  startTimeSec: number;
  gameState: WorldSnapshot['gameState'];
};

function findLastWaypoint(
  waypoints: PersistedBallWaypointShape[],
  label: PersistedBallWaypointShape['label'],
): PersistedBallWaypointShape | undefined {
  for (let i = waypoints.length - 1; i >= 0; i--) {
    if (waypoints[i].label === label) return waypoints[i];
  }
  return undefined;
}

function buildDefenseFrameForThrow(
  defenseTemplate: FielderEntity[],
  throwerPos: Position,
  from: { x: number; y: number },
  to: { x: number; y: number },
): FielderEntity[] {
  const frame = cloneFielders(defenseTemplate);
  const thrower = frame.find((f) => f.position === throwerPos);
  if (thrower) {
    thrower.pos = { ...from };
    thrower.state = { type: 'throwing', target: { ...to }, windupSec: 0 };
  }
  const firstBaseFielder = frame.find((f) => f.position === 'B1');
  if (firstBaseFielder) {
    firstBaseFielder.pos = { ...to };
    firstBaseFielder.state = { type: 'covering', base: { ...to } };
  }
  return frame;
}

export function buildGroundOutThrowSequence(
  input: GroundOutThrowSequenceInput,
): { snapshots: WorldSnapshot[]; endTimeSec: number } {
  const firstBase = getBaseAnchor('first');
  const fieldedWaypoint = findLastWaypoint(input.waypoints, 'fielded');
  const startWaypoint = fieldedWaypoint
    ?? findLastWaypoint(input.waypoints, 'landing')
    ?? input.waypoints[input.waypoints.length - 1]
    ?? input.fallbackStart;
  const throwFrom = { x: startWaypoint.x, y: startWaypoint.y };
  const throwFromZ = Math.max(0.8, startWaypoint.z);
  const distanceFt = Math.hypot(firstBase.x - throwFrom.x, firstBase.y - throwFrom.y);
  const thrower = input.defense.find((f) => f.position === input.throwerPos);
  const throwVeloFps = Math.max(1, thrower?.throwVeloFps ?? 1);
  const throwDuration = Math.max(0.25, distanceFt / throwVeloFps);
  const throwSteps = Math.max(2, Math.ceil(throwDuration / SEGMENT_DT_SEC));
  const throwStepDuration = throwDuration / throwSteps;
  const throwVel = {
    x: (firstBase.x - throwFrom.x) / throwDuration,
    y: (firstBase.y - throwFrom.y) / throwDuration,
    z: 6 / throwDuration,
  };

  const snapshots: WorldSnapshot[] = [];
  let time = input.startTimeSec;

  const throwStartEvents: TickEvent[] = fieldedWaypoint
    ? [{ type: 'throw-released', from: input.throwerPos, toBase: 'first' }]
    : [
        { type: 'ball-fielded', by: input.throwerPos, at: { x: throwFrom.x, y: throwFrom.y } },
        { type: 'throw-released', from: input.throwerPos, toBase: 'first' },
      ];

  snapshots.push({
    time,
    ball: { pos: { x: throwFrom.x, y: throwFrom.y, z: throwFromZ }, state: { type: 'held', by: input.throwerPos }, bounceCount: 0 },
    fielders: buildDefenseFrameForThrow(input.defense, input.throwerPos, throwFrom, firstBase),
    runners: buildPlayRunners(
      input.beforeBase,
      input.afterBase,
      'ground-out',
      0.9,
      input.runsScored,
      input.batterRunnerId,
      input.resolveRunnerProfile,
      input.batterRunnerProfile,
    ),
    events: throwStartEvents,
    gameState: input.gameState,
  });
  time += 0.15;

  for (let throwStep = 1; throwStep <= throwSteps; throwStep++) {
    const u = throwStep / throwSteps;
    const x = lerp(throwFrom.x, firstBase.x, u);
    const y = lerp(throwFrom.y, firstBase.y, u);
    const z = 1.8 + 7 * Math.sin(Math.PI * u);
    const arrived = throwStep === throwSteps;
    const throwEvents: TickEvent[] = arrived
      ? [
          { type: 'ball-received', by: 'B1', at: { x: firstBase.x, y: firstBase.y } },
          { type: 'runner-out', runnerId: input.batterRunnerId, runnerName: input.batterName, at: 'first' },
        ]
      : [];

    snapshots.push({
      time,
      ball: {
        pos: { x, y, z },
        state: arrived
          ? { type: 'held', by: 'B1' }
          : { type: 'thrown', vel: throwVel, target: { x: firstBase.x, y: firstBase.y }, thrower: input.throwerPos },
        bounceCount: 0,
      },
      fielders: buildDefenseFrameForThrow(input.defense, input.throwerPos, throwFrom, firstBase),
      runners: arrived
        ? buildBaseRunners(input.afterBase, input.resolveRunnerProfile)
        : buildPlayRunners(
          input.beforeBase,
          input.afterBase,
          'ground-out',
          0.9,
          input.runsScored,
          input.batterRunnerId,
          input.resolveRunnerProfile,
          input.batterRunnerProfile,
        ),
      events: throwEvents,
      gameState: input.gameState,
    });
    time += throwStepDuration;
  }

  return { snapshots, endTimeSec: time };
}
