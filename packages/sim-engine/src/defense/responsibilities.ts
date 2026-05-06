// Last touched by agent: 2026-05-06T12:36:52Z
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
 * Outfielder throw rule — "throw ahead of the runner":
 *   - No runners on base  → throw to 2B (batter rounding 1B)
 *   - Runner on 1B only   → throw to 3B (ahead of the lead runner)
 *   - Runner on 2B / 3B   → throw home (ahead of the lead runner)
 *   - Sac fly             → throw home (tag play at the plate)
 *
 * 2B cover on OF plays (who receives at 2B):
 *   - Hit to LF  → SS covers 2B
 *   - Hit to RF  → 2B covers 2B
 *   - Hit to CF  → depends on batter hand:
 *       RHB → 2B covers 2B (SS moves toward 3B hole)
 *       LHB → SS covers 2B (2B shades toward 1B hole)
 *
 * MLB textbook cutoff / backup:
 *   - Throw home from OF  → 1B is the cutoff,  P backs up home
 *   - Throw to 3B from OF → SS is the cutoff,  P backs up 3B
 *   - Throw to 2B from OF → cover with 2B or SS (per above),
 *                           the OTHER MIF trails as relay,
 *                           CF backs up the bag from depth
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
  /** Positive means defense leads by this many runs. */
  defenseLeadDeficit?: number;
  sprayAngleDeg: number;
  /** Batter hand — needed for CF plays to decide who covers 2B. */
  batterHand?: 'L' | 'R' | 'S';
  /** When set, overrides the computed throw target (used by the PI
   *  downgrade path to regenerate coverage for a different base). */
  forceTarget?: Base;
}): CoverageAssignments {
  const { fielder, fieldedAt, result, bases, sprayAngleDeg } = args;
  const r1 = !!bases[0];
  const r2 = !!bases[1];
  const r3 = !!bases[2];
  const isOF = OUTFIELD.has(fielder);
  const batterHand = args.batterHand ?? 'R';  // default RHB
  const defenseLeadDeficit = args.defenseLeadDeficit ?? 0;

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

  if (!args.forceTarget && noThrowResults.has(result)) return result_default;

  // ───── Infield plays — existing emitter handles the simple
  // ───── ground-out / DP / FC throws. Here we just supply the
  // ───── cover info so the visualizer has a single entry point.
  if (!isOF && !args.forceTarget) {
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

  // ───── Outfield plays ─────────────────────────────────────────
  // "Throw ahead of the runner" — the OF always throws to the base
  // the lead runner is heading toward.
  // When forceTarget is set, use it directly (PI downgrade already
  // decided the base).
  let target: Base;
  if (args.forceTarget) {
    target = args.forceTarget;
  } else if (result === 'sac-fly') {
    // Sac fly is always a throw home (tag play at the plate).
    target = 'home';
  } else if (args.outs < 2 && r3) {
    // With <2 outs and a runner at 3B, hold the runner and take the
    // sure out at 1B instead of forcing a risky throw home.
    target = 'first';
  } else if (defenseLeadDeficit >= 5 && (r2 || r3)) {
    // Up big, prioritize getting an out over a high-risk throw home.
    target = 'second';
  } else if (r2 || r3) {
    // Lead runner is on 2B or 3B → throw home.
    target = 'home';
  } else if (r1) {
    // Lead runner on 1B → throw to 3B (ahead of the runner).
    target = 'third';
  } else {
    // No runners → throw to 2B (batter rounding 1B).
    target = 'second';
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
  } else if (target === 'first') {
    // Hold-runner / sure-out path on OF plays: 1B takes the throw,
    // 2B relays as cutoff, pitcher trails behind the bag.
    covers.push({ position: 'B1', base: 'first', toPoint: basePoint('first') });
    cutoff = {
      position: 'B2',
      toPoint: pointOnLine(targetPt, fieldedAt, 0.45),
      forBase: 'first',
    };
    backups.push({
      position: 'P',
      toPoint: pointOnLine(targetPt, fieldedAt, 0.18),
      forBase: 'first',
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
    // ── Who covers 2B? Depends on where the ball was hit + batter hand ──
    //   Hit to LF  → SS covers 2B
    //   Hit to RF  → 2B covers 2B
    //   Hit to CF  → RHB: 2B covers,  LHB/SHB: SS covers
    let coverPos: Position;
    let trailPos: Position;  // the other MIF trails as relay
    if (fielder === 'LF' || (fielder === 'CF' && (batterHand === 'L' || batterHand === 'S'))) {
      coverPos = 'SS';
      trailPos = 'B2';
    } else {
      // RF, or CF with RHB
      coverPos = 'B2';
      trailPos = 'SS';
    }
    covers.push({ position: coverPos, base: 'second', toPoint: basePoint('second') });
    cutoff = {
      position: trailPos,
      toPoint: pointOnLine(targetPt, fieldedAt, 0.45),
      forBase: 'second',
    };
    // CF backs up the bag from depth on throws to 2B.
    if (fielder !== 'CF') {
      backups.push({
        position: 'CF',
        toPoint: pointOnLine(targetPt, FIELDER_POSITIONS_FT.CF, 0.12),
        forBase: 'second',
      });
    }
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
