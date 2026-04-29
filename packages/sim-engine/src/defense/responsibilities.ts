/**
 * Defensive responsibilities — who covers, who cuts off, who backs up.
 *
 * This is a deterministic data-only module: given (ball location,
 * fielder who made the play, hit result, runners on base, outs),
 * return the standard MLB textbook assignments. PI / aggression
 * rolls layer ON TOP of this in Phase 3 — for now every play uses
 * the textbook.
 *
 * Conventions:
 *   - Field origin = home plate. +x toward 1B/RF, +y toward CF.
 *   - "Cutoff" is the IF who lines up between the OF and the throw
 *     target, intercepting (or letting pass) the relay.
 *   - "Cover" is the IF who stands on a bag to receive the throw.
 *   - "Backup" is the player who positions BEHIND the receiver in
 *     case of an overthrow.
 *
 * MLB textbook used here:
 *   - Throw home from OF        → 1B is the cutoff,   P backs up home
 *   - Throw to 3B from OF       → SS is the cutoff,   P backs up 3B
 *   - Throw to 2B from OF       → cover with B2 (RF) or SS (LF/CF),
 *                                 the OTHER MIF trails as cutoff,
 *                                 no P backup needed
 *   - On a hit with batter rounding 1B but no runners advancing, B1
 *     stays in the infield and lines up the trail throw (per user
 *     guidance: "1B typically used because relays go to 3B/home and
 *     no one is needed to cover 1B").
 *   - Pitcher waits between 3B and home until the throw target is
 *     known, then breaks behind the receiver.
 */
import type { Position } from '../config';
import type { AtBatResult } from '../types';
import { FIELDER_POSITIONS_FT } from '../physics/positions';
import { BASE_COORDS_FT } from '../physics/speed';

export type Base = 'first' | 'second' | 'third' | 'home';

export interface CoverAssignment {
  position: Position;
  base: Base;
  toPoint: { x: number; y: number };
}
export interface CutoffAssignment {
  position: Position;
  /** Where the cutoff fielder lines up — on the line between the
   *  fielding spot and the target base, ~60% of the way toward the
   *  base (so they can field a long throw and relay it). */
  toPoint: { x: number; y: number };
  /** Where the throw the cutoff intercepts is going. */
  forBase: Base;
}
export interface BackupAssignment {
  position: Position;
  /** Backup stands ~12 ft behind the receiving base on the throw line. */
  toPoint: { x: number; y: number };
  forBase: Base;
}

export interface CoverageAssignments {
  /** Where the play's primary throw is going (null = no throw). */
  throwTarget: Base | null;
  /** When non-null, the OF throw is intercepted/relayed by this IF. */
  cutoff: CutoffAssignment | null;
  /** Bag covers — only emit positions that are NOT the fielder. */
  covers: CoverAssignment[];
  /** Defenders behind receiving bases. */
  backups: BackupAssignment[];
}

const OUTFIELD: ReadonlySet<Position> = new Set(['LF', 'CF', 'RF']);

function basePoint(b: Base): { x: number; y: number } {
  return b === 'home' ? { x: 0, y: 0 } : BASE_COORDS_FT[b];
}

/**
 * Compute a point on the line from `fielderPt` to `basePt`, `frac` of
 * the way from the BASE toward the fielder. So frac=0 is on the bag,
 * frac=1 is at the fielder. Used for cutoff / backup positioning.
 */
function pointOnLine(
  basePt: { x: number; y: number },
  fielderPt: { x: number; y: number },
  frac: number,
): { x: number; y: number } {
  return {
    x: basePt.x + (fielderPt.x - basePt.x) * frac,
    y: basePt.y + (fielderPt.y - basePt.y) * frac,
  };
}

/**
 * Decide the standard textbook coverage for a batted ball that has
 * been fielded by `fielder` with the given result and base/out state.
 */
export function getCoverage(args: {
  fielder: Position;
  fieldedAt: { x: number; y: number };
  result: AtBatResult;
  /** [r1, r2, r3] — truthy if occupied. */
  bases: readonly (unknown | null)[];
  outs: number;
  sprayAngleDeg: number;
}): CoverageAssignments {
  const { fielder, fieldedAt, result, bases, sprayAngleDeg } = args;
  const r1 = !!bases[0];
  const r2 = !!bases[1];
  const r3 = !!bases[2];
  const isOF = OUTFIELD.has(fielder);
  const sprayLeft = sprayAngleDeg < 0;          // ball pulled to LF/CF gap
  const sprayRight = sprayAngleDeg > 0;         // ball to RF/CF gap

  // No throw on a HR or anything that ends with the ball already at
  // a base. Caught flies / line outs / pop outs / foul outs need no
  // base throw (sac-fly is handled below as an OF throw home).
  const noThrowResults: ReadonlySet<AtBatResult> = new Set([
    'home-run', 'walk', 'hbp', 'strikeout', 'foul-out',
    'fly-out', 'line-out', 'pop-out',
  ]);

  // Default empty.
  const result_default: CoverageAssignments = {
    throwTarget: null, cutoff: null, covers: [], backups: [],
  };

  if (noThrowResults.has(result)) return result_default;

  // ───── Infield plays — existing emitter handles the simple
  // ───── ground-out / DP / FC throws. Here we just supply the
  // ───── cover info so the visualizer has a single entry point.
  if (!isOF) {
    if (result === 'ground-out' || result === 'reached-on-error') {
      const cover: Position = fielder === 'B1' ? 'P' : 'B1';
      return {
        throwTarget: 'first',
        cutoff: null,
        covers: cover === fielder ? [] : [{
          position: cover, base: 'first', toPoint: basePoint('first'),
        }],
        backups: [],
      };
    }
    if (result === 'fielders-choice') {
      const cover: Position = fielder === 'B2' ? 'SS' : 'B2';
      return {
        throwTarget: 'second',
        cutoff: null,
        covers: [{ position: cover, base: 'second', toPoint: basePoint('second') }],
        backups: [
          // CF backs up 2B on FCs.
          { position: 'CF', toPoint: pointOnLine(basePoint('second'), FIELDER_POSITIONS_FT.CF, 0.12), forBase: 'second' },
        ],
      };
    }
    if (result === 'double-play') {
      const pivot: Position = fielder === 'B2' ? 'SS' : 'B2';
      return {
        throwTarget: 'second',
        cutoff: null,
        covers: [
          { position: pivot, base: 'second', toPoint: basePoint('second') },
          { position: fielder === 'B1' ? 'P' : 'B1', base: 'first', toPoint: basePoint('first') },
        ],
        backups: [],
      };
    }
    return result_default;
  }

  // ───── Outfield plays — primary throw target depends on the hit
  // ───── type and what runners can score.
  let target: Base;
  if (result === 'sac-fly') {
    target = 'home';
  } else if (result === 'single') {
    if (r2 || r3) target = 'home';
    else if (r1) target = 'third';
    else target = 'second';      // batter rounding 1B
  } else if (result === 'double') {
    if (r1 || r2 || r3) target = 'home';
    else target = 'third';
  } else if (result === 'triple') {
    target = 'home';
  } else {
    return result_default;
  }

  const targetPt = basePoint(target);

  // Cover and cutoff per target:
  const covers: CoverAssignment[] = [];
  let cutoff: CutoffAssignment | null = null;
  const backups: BackupAssignment[] = [];

  if (target === 'home') {
    // C covers home (always there). 1B is cutoff. P backs up home.
    covers.push({ position: 'C', base: 'home', toPoint: basePoint('home') });
    cutoff = {
      position: 'B1',
      toPoint: pointOnLine(targetPt, fieldedAt, 0.45),
      forBase: 'home',
    };
    backups.push({
      position: 'P',
      toPoint: pointOnLine(targetPt, fieldedAt, 0.18),
      forBase: 'home',
    });
  } else if (target === 'third') {
    // 3B covers (unless 3B fielded). SS is cutoff. P backs up 3B.
    if (fielder !== 'B3') {
      covers.push({ position: 'B3', base: 'third', toPoint: basePoint('third') });
    }
    cutoff = {
      position: 'SS',
      toPoint: pointOnLine(targetPt, fieldedAt, 0.40),
      forBase: 'third',
    };
    backups.push({
      position: 'P',
      toPoint: pointOnLine(targetPt, fieldedAt, 0.18),
      forBase: 'third',
    });
  } else if (target === 'second') {
    // No-runners single — batter rounding 1B. Per user's note:
    //   ball to RF → B2 trails as cutoff, SS covers 2B
    //   ball to LF/CF → SS trails as cutoff, B2 covers 2B
    if (sprayRight) {
      covers.push({ position: 'SS', base: 'second', toPoint: basePoint('second') });
      cutoff = {
        position: 'B2',
        toPoint: pointOnLine(targetPt, fieldedAt, 0.45),
        forBase: 'second',
      };
    } else {
      covers.push({ position: 'B2', base: 'second', toPoint: basePoint('second') });
      cutoff = {
        position: 'SS',
        toPoint: pointOnLine(targetPt, fieldedAt, 0.45),
        forBase: 'second',
      };
    }
    // No P backup on a throw to 2B; CF backs up the bag from depth.
    backups.push({
      position: 'CF',
      toPoint: pointOnLine(targetPt, FIELDER_POSITIONS_FT.CF, 0.12),
      forBase: 'second',
    });
  }

  // Strip any cover/cutoff/backup whose position IS the fielder
  // (can't be in two places).
  return {
    throwTarget: target,
    cutoff: cutoff && cutoff.position !== fielder ? cutoff : null,
    covers: covers.filter(c => c.position !== fielder),
    backups: backups.filter(b => b.position !== fielder),
  };
}
