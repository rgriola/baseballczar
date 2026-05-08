// Last touched by agent: 2026-05-07T18:02:00Z
// Purpose: Centralized base anchors and offsets for runner/fielder placement.
import { BASE_COORDS_FT, type Position } from '@baseballczar/sim-engine';
import type { Point2D } from './entities';

export type BaseName = 'home' | 'first' | 'second' | 'third';
export type OccupiedBase = Exclude<BaseName, 'home'>;

// Immutable bag anchors (game-rule coordinates) sourced from sim-engine.
export const BASE_ANCHORS: Record<BaseName, Point2D> = {
  home: { ...BASE_COORDS_FT.home },
  first: { ...BASE_COORDS_FT.first },
  second: { ...BASE_COORDS_FT.second },
  third: { ...BASE_COORDS_FT.third },
};

// Visual stand points while runners are safe on a bag.
export const RUNNER_ON_BASE_OFFSETS_FT: Record<OccupiedBase, Point2D> = {
  // Shade the 1B runner toward 2B without moving the bag anchor.
  first: { x: -2.5, y: 2.5 },
  // Keep runner slightly to the infield side for clearer visual separation.
  second: { x: -1, y: 0 },
  third: { x: 0, y: 0 },
};

const FIELDER_COVER_DEFAULT_OFFSETS_FT: Record<OccupiedBase, Point2D> = {
  // Keep receivers at 1B on the infield side so they stay out of the runner lane.
  first: { x: -4, y: 4 },
  second: { x: 0, y: -1.5 },
  third: { x: 0, y: 0 },
};

const FIELDER_COVER_POSITION_OFFSETS_FT: Partial<
  Record<Position, Partial<Record<OccupiedBase, Point2D>>>
> = {
  B2: {
    second: { x: 2, y: -1.5 },
  },
  SS: {
    second: { x: -2, y: -1.5 },
  },
};

function offsetPoint(anchor: Point2D, offset: Point2D): Point2D {
  return {
    x: anchor.x + offset.x,
    y: anchor.y + offset.y,
  };
}

export function getBaseAnchor(base: BaseName): Point2D {
  const anchor = BASE_ANCHORS[base];
  return { x: anchor.x, y: anchor.y };
}

export function getRunnerOnBasePoint(base: OccupiedBase): Point2D {
  const anchor = BASE_ANCHORS[base];
  const offset = RUNNER_ON_BASE_OFFSETS_FT[base];
  return offsetPoint(anchor, offset);
}

export function getFielderCoverPoint(base: OccupiedBase, position: Position): Point2D {
  const anchor = BASE_ANCHORS[base];
  const positionOffset = FIELDER_COVER_POSITION_OFFSETS_FT[position]?.[base];
  const offset = positionOffset ?? FIELDER_COVER_DEFAULT_OFFSETS_FT[base];
  return offsetPoint(anchor, offset);
}
