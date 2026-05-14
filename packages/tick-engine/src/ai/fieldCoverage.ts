/**
 * Fielder coverage AI — situational positioning during live plays.
 *
 * Handles:
 *   - Dynamic role reassignment based on ball/runner state
 *   - Situational base coverage (who covers which bag)
 *   - Throw target coverage (ensuring someone receives throws)
 *   - Predictive tracking for fielders chasing fly balls
 */
import type { BallEntity, FielderEntity, RunnerEntity, Point2D } from '../entities';
import type { Position } from '@baseballczar/sim-engine';
import { dist2D, COLLIDERS } from '../spatial';
import { BASE_POS } from '../runnerAI';
import { getBaseAnchor, getFielderCoverPoint, type BaseName, type OccupiedBase } from '../fieldGeometry';
import { closestBaseTo, type GameSituation } from './types';

// ─── Fielder role reassignment ───────────────────────────────────

/**
 * Dynamically reassign fielder roles based on ball/runner state.
 * Called every tick during live ball situations. This is the
 * "reactive" tier — adjusting coverage as the play develops.
 */
export function reassignFielderRoles(
  fielders: FielderEntity[],
  ball: BallEntity,
  runners: RunnerEntity[],
  situation: GameSituation,
): void {
  // During throws, ensure someone covers the throw target
  if (ball.state.type === 'thrown') {
    ensureThrowTargetCovered(fielders, ball.state.target);
    return;
  }

  // During rolling/idle ball, assign situational coverage to non-busy fielders
  if (ball.state.type === 'rolling' || ball.state.type === 'idle' || ball.state.type === 'in-flight') {
    applySituationalCoverage(fielders, runners, situation, ball);
  }
}

// ─── Situational coverage logic ─────────────────────────────────

/**
 * Decide where a non-primary fielder should go based on the game
 * situation. Considers runner positions, outs, and ball location.
 */
function applySituationalCoverage(
  fielders: FielderEntity[],
  runners: RunnerEntity[],
  situation: GameSituation,
  ball: BallEntity,
): void {
  // Only assign idle/returning/backing-up fielders — don't override
  // anyone actively tracking, chasing, holding, throwing, or covering.
  const occupiedBases = new Set<string>();
  for (const r of runners) {
    if (r.state.type === 'on-base') occupiedBases.add(r.state.base);
    if (r.state.type === 'running') {
      const targetBase = closestBaseTo(r.state.to);
      occupiedBases.add(targetBase);
    }
  }

  // Always need home covered
  occupiedBases.add('home');

  // Build a list of bases that need coverage based on ACTUAL runners.
  // Only cover bases where a runner could realistically advance.
  const basesToCover: BaseName[] = [];
  // First base always needs coverage (batter-runner heading there)
  basesToCover.push('first');
  // Second only if runner on first could advance there
  if (occupiedBases.has('first')) basesToCover.push('second');
  // Third only if runner on second could advance there
  if (occupiedBases.has('second')) basesToCover.push('third');
  basesToCover.push('home');  // catcher always covers home

  // Track which bases already have a fielder covering them
  const coveredBases = new Set<string>();
  for (const f of fielders) {
    if (f.state.type === 'covering') {
      const base = closestBaseTo(f.state.base);
      coveredBases.add(base);
    }
  }

  // Natural position-to-base affinity
  const positionBaseAffinity: Partial<Record<Position, BaseName>> = {
    C: 'home',
    B1: 'first',
    B2: 'second',
    SS: 'second',
    B3: 'third',
    P: 'home',  // pitcher backs up home or covers first
  };

  for (const f of fielders) {
    // Only reassign fielders that are not busy
    if (f.state.type !== 'idle' && f.state.type !== 'returning' && f.state.type !== 'backing-up') {
      continue;
    }

    // Skip outfielders — they should be backing up, not covering bases
    if (['LF', 'CF', 'RF'].includes(f.position)) continue;

    const naturalBase = positionBaseAffinity[f.position];
    if (!naturalBase) continue;

    // If the base we'd naturally cover needs it and isn't covered yet
    if (basesToCover.includes(naturalBase) && !coveredBases.has(naturalBase)) {
      const coverPoint = naturalBase === 'home'
        ? getBaseAnchor('home')
        : getFielderCoverPoint(naturalBase as OccupiedBase, f.position);
      f.state = { type: 'covering', base: coverPoint };
      coveredBases.add(naturalBase);
    }
  }

  // Special: pitcher covers first if B1 is the primary fielder
  const b1 = fielders.find(f => f.position === 'B1');
  const pitcher = fielders.find(f => f.position === 'P');
  if (b1 && pitcher &&
      (b1.state.type === 'chasing' || b1.state.type === 'tracking' || b1.state.type === 'has-ball') &&
      (pitcher.state.type === 'idle' || pitcher.state.type === 'returning' || pitcher.state.type === 'backing-up') &&
      !coveredBases.has('first')) {
    pitcher.state = { type: 'covering', base: getFielderCoverPoint('first', 'P') };
    coveredBases.add('first');
  }
}

// ─── Throw target coverage ──────────────────────────────────────

function ensureThrowTargetCovered(
  fielders: FielderEntity[],
  throwTarget: Point2D,
): void {
  // Check if someone is already covering the throw target
  for (const f of fielders) {
    if (f.state.type === 'covering') {
      const coverDist = dist2D(f.state.base, throwTarget);
      if (coverDist < COLLIDERS.receiveThrow) {
        return;  // Already covered
      }
    }
  }

  // No one is covering the target — find the closest idle/returning infielder
  const targetBase = closestBaseTo(throwTarget);
  const basePt = BASE_POS[targetBase];
  if (!basePt) return;

  const candidates = fielders.filter(f =>
    (f.state.type === 'idle' || f.state.type === 'returning' || f.state.type === 'backing-up')
    && ['B1', 'B2', 'SS', 'B3', 'C', 'P'].includes(f.position)
    && (targetBase === 'home' || f.position !== 'C')
  );

  const preferredByBase: Record<BaseName, Position[]> = {
    home: ['C', 'P', 'B3'],
    first: ['B1', 'P', 'B2'],
    second: ['B2', 'SS', 'B1'],
    third: ['B3', 'SS', 'P'],
  };
  const preferred = preferredByBase[targetBase] ?? [];

  const closest = candidates.sort((a, b) => {
    const aPref = preferred.includes(a.position) ? 0 : 1;
    const bPref = preferred.includes(b.position) ? 0 : 1;
    if (aPref !== bPref) return aPref - bPref;
    return dist2D(a.pos, basePt) - dist2D(b.pos, basePt);
  })[0];

  if (closest) {
    const coverPoint = targetBase === 'home'
      ? getBaseAnchor('home')
      : getFielderCoverPoint(targetBase as OccupiedBase, closest.position);
    closest.state = { type: 'covering', base: coverPoint };
  }
}

// ─── Predictive tracking (fielder AI enhancement) ────────────────

/**
 * Update a tracking fielder's target using ball trajectory prediction.
 * Instead of running to a static point, the fielder continuously
 * adjusts toward where the ball WILL BE.
 */
export function updatePredictedTracking(
  fielder: FielderEntity,
  ball: BallEntity,
): void {
  if (fielder.state.type !== 'tracking') return;
  if (ball.state.type !== 'in-flight') return;

  const vel = ball.state.vel;
  const vz = vel.z;
  const z = ball.pos.z;
  const g = 32.174;

  // Predict landing point using current velocity
  const disc = vz * vz + 2 * g * z;
  if (disc < 0) return;
  const tLand = (vz + Math.sqrt(disc)) / g;

  // Horizontal position at landing (with simple drag estimate)
  const dragFactor = 0.85;  // rough average drag over remaining flight
  const predictedLanding: Point2D = {
    x: ball.pos.x + vel.x * tLand * dragFactor,
    y: ball.pos.y + vel.y * tLand * dragFactor,
  };

  // Update the fielder's tracking target
  fielder.state.target = predictedLanding;
}
