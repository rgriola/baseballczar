// Last touched by agent: 2026-05-07T21:44:21Z
// Purpose: Applies outcome-specific transforms to persisted batted-ball waypoints.

import type { PersistedBallWaypointShape } from './persisted-replay-motion';
import { isCatchOutOutcome } from './persisted-replay-outcome';

export function withCatchOutWaypoints(
  outcome: string,
  waypoints: PersistedBallWaypointShape[],
): PersistedBallWaypointShape[] {
  if (!isCatchOutOutcome(outcome)) return waypoints;

  const fieldedWaypoint = waypoints.find((w) => w.label === 'fielded');
  const landingWaypoint = waypoints.find((w) => w.label === 'landing');
  const catchSource = fieldedWaypoint ?? landingWaypoint;
  if (!catchSource) return waypoints;

  const catchWaypoint: PersistedBallWaypointShape = {
    ...catchSource,
    label: 'fielded',
    z: Math.max(8, catchSource.z),
  };

  const basePath = waypoints.filter((w) => (
    w.label !== 'landing'
    && w.label !== 'rest'
    && w.label !== 'fielded'
  ));

  const transformed = [...basePath, catchWaypoint];
  transformed.sort((a, b) => {
    const aHasTime = typeof a.tSec === 'number';
    const bHasTime = typeof b.tSec === 'number';
    if (aHasTime && bHasTime) return (a.tSec as number) - (b.tSec as number);
    if (aHasTime) return -1;
    if (bHasTime) return 1;
    return 0;
  });

  return transformed;
}
