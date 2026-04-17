import type { PlayerSkills, PitcherAttributes, SkillThresholds } from './types';

/**
 * Calculate hitter skill thresholds from raw 0-100 attributes.
 * Translated from Hitters.java Calculate_Skill()
 *
 * The thresholds define cumulative probability ranges on [0, 1]:
 *   [0, S]        → single
 *   (S, D]        → double
 *   (D, T]        → triple
 *   (T, HR]       → home run
 *   (HR, BB]      → walk
 *   (BB, K]       → strikeout
 *   (K, 1]        → ground-ball out
 */
export function calculateHitterSkill(skills: PlayerSkills): SkillThresholds {
  const AG_f = 0.025;
  const AVG_f = 0.007;
  const POWER_f = 0.025;
  const EYE_f = 0.03;
  const DHR_f = 0.05;
  const SPEED_f = 0.002;

  const xAG = skills.ag * AG_f + 0.1;
  const xAVG = skills.avg * AVG_f + 0.1;
  const xPOWER = skills.power * POWER_f + 0.05;
  const xEYE = skills.eye * EYE_f + 0.15;
  const xDHR = skills.dhr * DHR_f + 0.35;
  const xSPEED = skills.speed * SPEED_f + 0.003;

  const BBs = xAG * xEYE;
  const Ks = xAG - BBs;
  const Ds = xAVG * xPOWER * xDHR;
  const HRs = xAVG * xPOWER - Ds;
  const Ts = xSPEED;
  const S = (xAVG - Ts) - (xAVG * xPOWER);

  const D = S + Ds;
  const T = D + Ts;
  const HR = T + HRs;
  const BB = HR + BBs;
  const K = BB + Ks;

  const TOT = skills.avg + skills.power + skills.eye;

  return { S, D, T, HR, BB, K, TOT };
}

/**
 * Calculate pitcher skill thresholds from raw 0-100 attributes.
 * Translated from Pitchers.java PitcherCalcSkill()
 *
 * Pitcher factors are negative (inverted) — higher skill means
 * lower thresholds for hits/power/walks, making the pitcher harder to hit.
 */
export function calculatePitcherSkill(
  skills: PitcherAttributes,
  battersFaced: number,
): SkillThresholds {
  // Apply stamina degradation first
  const degraded = applyStaminaDecay(skills, battersFaced);

  const AG_f = 0.0272;
  const AVG_f = -0.014545;
  const POWER_f = -0.0364;
  const EYE_f = -0.0418;
  const DHR_f = -0.054545;
  const SPEED_f = 0.002;

  const xAG = degraded.ag * AG_f + 0.15;
  const xAVG = degraded.avg * AVG_f + 0.31;
  const xPOWER = degraded.power * POWER_f + 0.5;
  const xEYE = degraded.eye * EYE_f + 0.6;
  const xDHR = degraded.dhr * DHR_f + 0.95;
  const xSPEED = degraded.speed * SPEED_f + 0.003;

  const BBs = xAG * xEYE;
  const Ks = xAG - BBs;
  const Ds = xAVG * xPOWER * xDHR;
  const HRs = xAVG * xPOWER - Ds;
  const Ts = xSPEED;
  const S = (xAVG - Ts) - (xAVG * xPOWER);

  const D = S + Ds;
  const T = D + Ts;
  const HR = T + HRs;
  const BB = HR + BBs;
  const K = BB + Ks;

  const TOT = degraded.avg + degraded.power + degraded.eye;

  return { S, D, T, HR, BB, K, TOT };
}

/**
 * Stamina decay — degrades pitcher AVG/POWER/EYE after passing
 * a batter-faced threshold determined by PI (pitch intelligence).
 * Translated from Pitchers.java staminaCalc()
 */
function applyStaminaDecay(
  skills: PitcherAttributes,
  battersFaced: number,
): PitcherAttributes {
  const staminaFactorMap: Record<number, number> = {
    10: 0.025, 9: 0.03, 8: 0.035, 7: 0.04, 6: 0.05,
    5: 0.06, 4: 0.065, 3: 0.075, 2: 0.09, 1: 0.1,
  };

  const batterThresholdMap: Record<number, number> = {
    10: 33, 9: 30, 8: 27, 7: 23, 6: 19,
    5: 17, 4: 15, 3: 13, 2: 10, 1: 7, 0: 5,
  };

  const staminaFactor = staminaFactorMap[Math.min(10, Math.max(1, skills.stamina))] ?? 0.05;
  const batterThreshold = batterThresholdMap[Math.min(10, Math.max(0, skills.pitchIntel))] ?? 6;

  if (battersFaced <= batterThreshold) {
    return { ...skills };
  }

  let { avg, power, eye } = skills;

  avg = Math.max(0, avg - avg * staminaFactor);
  power = Math.max(0, power - power * staminaFactor);
  eye = Math.max(0, eye - eye * staminaFactor);

  return { ...skills, avg, power, eye };
}
