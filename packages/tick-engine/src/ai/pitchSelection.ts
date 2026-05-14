/**
 * Pitch selection AI — tactical per-at-bat pitch sequencing.
 *
 * The catcher (managed by the AI Manager) calls pitches based on:
 *   - Count (ahead/behind/even)
 *   - Batter tendencies (power, eye, discipline)
 *   - Pitcher repertoire (pitchIntel)
 *   - Game situation (runners, outs, score)
 */
import type { GameSituation } from './types';

export interface PitchCall {
  zone: 'in' | 'edge' | 'off';
  intent: 'strike' | 'chase' | 'waste' | 'setup';
  speed: 'hard' | 'off-speed' | 'breaking';
  /** PBP-friendly description of why this pitch was selected. */
  reasoning: string;
}

/**
 * Tactical pitch selection.
 */
export function selectPitch(
  balls: number,
  strikes: number,
  batterSkills: { power: number; eye: number; ag: number; dhr: number },
  pitcherIntel: number,
  situation: GameSituation,
  pitchSequence: PitchCall[],  // what we've thrown so far this AB
): PitchCall {
  const count = `${balls}-${strikes}`;
  const ahead = strikes > balls;
  const behind = balls > strikes;
  const twoStrikes = strikes >= 2;
  const threeGalls = balls >= 3;
  const isPowerHitter = batterSkills.power >= 7;
  const hasGoodEye = batterSkills.eye >= 7;
  const isDisciplined = batterSkills.ag >= 7;
  const isFlyBallHitter = batterSkills.dhr >= 7;
  const lastPitch = pitchSequence[pitchSequence.length - 1];

  // Sequencing: vary speed from the last pitch
  const shouldChangeSpeed = lastPitch && lastPitch.speed === 'hard';

  // 3-0, 3-1: must throw a strike, give them something hittable
  if (threeGalls && strikes < 2) {
    return {
      zone: 'in',
      intent: 'strike',
      speed: 'hard',
      reasoning: `${count} count — needs to throw a strike`,
    };
  }

  // 0-2: classic putaway count — waste one or go for the chase
  if (strikes >= 2 && balls <= 1) {
    if (isDisciplined) {
      // Disciplined batter — need to paint the corner
      return {
        zone: 'edge',
        intent: 'chase',
        speed: shouldChangeSpeed ? 'breaking' : 'hard',
        reasoning: `${count} putaway — disciplined hitter, painting corner`,
      };
    }
    return {
      zone: 'off',
      intent: 'chase',
      speed: pitcherIntel >= 7 ? 'breaking' : 'off-speed',
      reasoning: `${count} putaway — expanding off the plate`,
    };
  }

  // Ahead in count — work the edges
  if (ahead) {
    if (isPowerHitter) {
      return {
        zone: 'off',
        intent: 'chase',
        speed: 'breaking',
        reasoning: `Ahead ${count} — breaking ball to power hitter`,
      };
    }
    return {
      zone: 'edge',
      intent: 'chase',
      speed: shouldChangeSpeed ? 'off-speed' : 'hard',
      reasoning: `Ahead ${count} — working the edge`,
    };
  }

  // Behind in count — need strikes
  if (behind) {
    if (hasGoodEye) {
      return {
        zone: 'in',
        intent: 'strike',
        speed: 'hard',
        reasoning: `Behind ${count} — fastball in the zone (good eye, can't nibble)`,
      };
    }
    return {
      zone: 'edge',
      intent: 'strike',
      speed: 'hard',
      reasoning: `Behind ${count} — competitive pitch on the edge`,
    };
  }

  // Even count or first pitch — setup pitch
  if (pitchSequence.length === 0) {
    // First pitch: high-intel pitchers start with off-speed to get ahead
    if (pitcherIntel >= 7) {
      return {
        zone: 'edge',
        intent: 'strike',
        speed: 'off-speed',
        reasoning: `First pitch — smart pitcher starting with off-speed`,
      };
    }
    return {
      zone: 'in',
      intent: 'strike',
      speed: 'hard',
      reasoning: `First pitch fastball`,
    };
  }

  // Default: work the edge with speed variation
  return {
    zone: 'edge',
    intent: 'setup',
    speed: shouldChangeSpeed ? 'off-speed' : 'hard',
    reasoning: `${count} — working the sequence`,
  };
}
