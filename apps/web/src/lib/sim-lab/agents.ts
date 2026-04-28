/**
 * Pitcher and Batter agents. Each pitch:
 *   1. Pitcher decides intent (zone + goal) given count + situation.
 *   2. Pitch's actual location may drift from intent (control degrades
 *      with fatigue / low pitchIntel).
 *   3. Batter perceives location (eye skill = perception accuracy).
 *   4. Batter decides swing (count + perceived location + skill).
 *   5. resolvePitch combines: ball / called-strike / whiff / foul / contact.
 */
import type { Player, PitchOutcome } from './types';
import { CONFIG } from './config';
import type { Rng } from './rng';

export interface PitchIntent {
  zone: 'in' | 'edge' | 'off';
  goal: 'strike' | 'chase' | 'waste' | 'put-away';
}

export interface PitchExecution {
  intent: PitchIntent;
  actualInZone: boolean;
  actualEdge: boolean;        // true if on the edge regardless of in/out
}

// ─── Pitcher ───────────────────────────────────────────────────
export function pitcherDecideIntent(
  pitcher: Player,
  balls: number,
  strikes: number,
  fatigueRatio: number,        // 0 = fresh, 1 = exhausted
  _rng: Rng,
): PitchIntent {
  // 3-0 / 3-1 → must throw a strike
  if (balls >= 3 && strikes < 2) {
    return { zone: 'in', goal: 'strike' };
  }
  // 0-2 → waste / put-away off the plate
  if (strikes >= 2 && balls <= 1) {
    return { zone: 'off', goal: 'put-away' };
  }
  // 1-2 / 2-2 → edge for a chase
  if (strikes === 2) {
    return { zone: 'edge', goal: 'chase' };
  }
  // Behind (2-0, 2-1) → strike
  if (balls > strikes) {
    return { zone: 'in', goal: 'strike' };
  }
  // Even / ahead → edge
  return { zone: 'edge', goal: 'chase' };
}

/**
 * Translate intent to actual location. Better pitchIntel + lower fatigue
 * means actual matches intent more often.
 */
export function executePitch(
  pitcher: Player,
  intent: PitchIntent,
  fatigueRatio: number,
  rng: Rng,
): PitchExecution {
  const piSkill = (pitcher.skills.pitchIntel + pitcher.skills.ag) / 2;
  // Control: 0.30 (skill 1, exhausted) up to 0.85 (skill 10, fresh)
  const control = 0.30 + (piSkill / 10) * 0.55 - fatigueRatio * 0.15;
  const hits = rng.bool(Math.max(0.20, Math.min(0.92, control)));

  if (hits) {
    // Intent achieved
    if (intent.zone === 'in') {
      return { intent, actualInZone: true, actualEdge: false };
    }
    if (intent.zone === 'edge') {
      // Edge: umpire makes the call. ~55% strike, ~45% ball.
      const calledStrike = rng.bool(CONFIG.pitch.edgeIsStrikeProb);
      return { intent, actualInZone: calledStrike, actualEdge: true };
    }
    // off-zone: clearly a ball
    return { intent, actualInZone: false, actualEdge: false };
  }
  // Missed intent: drift
  if (intent.zone === 'in') {
    // Tried strike, missed → ball or middle (50/50)
    const middle = rng.bool(0.5);
    return { intent, actualInZone: middle, actualEdge: false };
  }
  if (intent.zone === 'edge') {
    // Tried edge, missed → ball most often, sometimes middle
    const middle = rng.bool(0.3);
    return { intent, actualInZone: middle, actualEdge: false };
  }
  // Tried off, missed → on the edge or in zone (mistake pitch)
  const inZone = rng.bool(0.6);
  return { intent, actualInZone: inZone, actualEdge: !inZone };
}

// ─── Batter ────────────────────────────────────────────────────
export interface SwingDecision {
  swung: boolean;
}

export function batterDecideSwing(
  batter: Player,
  exec: PitchExecution,
  balls: number,
  strikes: number,
  rng: Rng,
): SwingDecision {
  const eyeSkill = batter.skills.eye;
  const agSkill = batter.skills.ag;
  // Perception accuracy: high eye → batter sees actual location well
  const perceptionAcc = 0.50 + (eyeSkill / 10) * 0.45;
  const perceivesInZone = rng.bool(perceptionAcc)
    ? exec.actualInZone
    : !exec.actualInZone;

  // 3-0 → take unless cocky power hitter and pitch is a meatball
  if (balls === 3 && strikes === 0) {
    return { swung: perceivesInZone && batter.skills.power >= 8 && rng.bool(0.2) };
  }
  // 2-strike protection
  if (strikes === 2) {
    if (perceivesInZone) return { swung: true };
    // Borderline → swing rate proportional to discipline (low ag = chase)
    const chase = 0.65 - (agSkill / 10) * 0.35;
    return { swung: rng.bool(chase) };
  }

  if (perceivesInZone) {
    // Normal in-zone swing rate, scaled by aggressiveness
    const swingRate = CONFIG.pitch.baseSwingInZoneRate
      + (10 - agSkill) * 0.01;
    return { swung: rng.bool(swingRate) };
  }
  // Out of zone → chase rate
  const chase = CONFIG.pitch.baseChaseRate
    - (agSkill - 5) * 0.03
    - (eyeSkill - 5) * 0.02;
  return { swung: rng.bool(Math.max(0.05, chase)) };
}

// ─── Resolve a single pitch (no contact = simple; contact = caller handles) ──
export type PitchResolution = {
  outcome: Exclude<PitchOutcome, 'in-play' | 'foul-out'>;
} | { outcome: 'in-play' };

export function resolvePitch(
  pitcher: Player,
  batter: Player,
  exec: PitchExecution,
  swing: SwingDecision,
  _balls: number,
  _strikes: number,
  rng: Rng,
): PitchResolution {
  if (!swing.swung) {
    return { outcome: exec.actualInZone ? 'called-strike' : 'ball' };
  }
  // Swing — contact or whiff?
  // Contact rate: hitter avg up, pitcher pitchIntel (stuff) down, lower out-of-zone
  const contactBase = CONFIG.pitch.baseContactRate;
  const hitterMod = (batter.skills.avg - 5) * 0.040;
  const pitcherMod = (pitcher.skills.pitchIntel - 5) * 0.035;
  const zoneMod = exec.actualInZone ? 0.05 : -0.10;
  const contact = Math.max(0.30, Math.min(0.95,
    contactBase + hitterMod - pitcherMod + zoneMod));

  if (!rng.bool(contact)) {
    return { outcome: 'swinging-strike' };
  }
  // Contact — foul or in-play?
  // 2-strike protective swings produce more fouls (battle the pitch).
  let foulRate = CONFIG.pitch.foulRate;
  if (_strikes === 2) foulRate += 0.10;
  else if (_strikes === 1) foulRate += 0.03;
  // Eye/avg hitters foul off tougher pitches a touch more often.
  foulRate += (batter.skills.eye - 5) * 0.008;
  const foul = rng.bool(Math.max(0.30, Math.min(0.85, foulRate)));
  if (foul) return { outcome: 'foul' };
  return { outcome: 'in-play' };
}
