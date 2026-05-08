// Last touched by agent: 2026-05-07T22:45:00Z
// Purpose: Emits replay ball events for persisted waypoint labels.

import type { TickEvent, WorldSnapshot } from '@baseballczar/tick-engine';
import type { PersistedBallWaypointShape, ZoneFielderResolver } from './persisted-replay-motion';
import { isCatchOutOutcome } from './persisted-replay-outcome';

export function eventForWaypoint(
  waypoint: PersistedBallWaypointShape,
  outcome: string,
  hitZone: string | null,
  resolveZoneFielder: ZoneFielderResolver,
  defenseFrame: WorldSnapshot['fielders'],
  previousWaypoint?: PersistedBallWaypointShape,
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
      return [{
        type: 'ball-caught',
        by: resolveZoneFielder(hitZone, { x: waypoint.x, y: waypoint.y }, defenseFrame),
        at: { x: waypoint.x, y: waypoint.y },
      }];
    }

    return [{
      type: 'ball-fielded',
      by: resolveZoneFielder(hitZone, { x: waypoint.x, y: waypoint.y }, defenseFrame),
      at: { x: waypoint.x, y: waypoint.y },
    }];
  }

  if (waypoint.label === 'rest') {
    return [];
  }

  return [];
}
