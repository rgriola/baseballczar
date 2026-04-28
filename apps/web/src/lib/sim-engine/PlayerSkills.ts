import type { PlayerSkills, PitcherAttributes, SkillThresholds } from './types';
import {
  HITTER,
  PITCHER,
  STAMINA_FACTOR,
  BATTER_THRESHOLD,
  STAMINA_FACTOR_DEFAULT,
  BATTER_THRESHOLD_DEFAULT,
} from './constants';

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
  const xAG = skills.ag * HITTER.AG_FACTOR + HITTER.AG_BASE;
  const xAVG = skills.avg * HITTER.AVG_FACTOR + HITTER.AVG_BASE;
  const xPOWER = skills.power * HITTER.POWER_FACTOR + HITTER.POWER_BASE;
  const xEYE = skills.eye * HITTER.EYE_FACTOR + HITTER.EYE_BASE;
  const xDHR = skills.dhr * HITTER.DHR_FACTOR + HITTER.DHR_BASE;
  const xSPEED = skills.speed * HITTER.SPEED_FACTOR + HITTER.SPEED_BASE;

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

  const xAG = degraded.ag * PITCHER.AG_FACTOR + PITCHER.AG_BASE;
  const xAVG = degraded.avg * PITCHER.AVG_FACTOR + PITCHER.AVG_BASE;
  const xPOWER = degraded.power * PITCHER.POWER_FACTOR + PITCHER.POWER_BASE;
  const xEYE = degraded.eye * PITCHER.EYE_FACTOR + PITCHER.EYE_BASE;
  const xDHR = degraded.dhr * PITCHER.DHR_FACTOR + PITCHER.DHR_BASE;
  const xSPEED = degraded.speed * PITCHER.SPEED_FACTOR + PITCHER.SPEED_BASE;

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
  const staminaFactor = STAMINA_FACTOR[Math.min(10, Math.max(1, skills.stamina))] ?? STAMINA_FACTOR_DEFAULT;
  const batterThreshold = BATTER_THRESHOLD[Math.min(10, Math.max(0, skills.pitchIntel))] ?? BATTER_THRESHOLD_DEFAULT;

  if (battersFaced <= batterThreshold) {
    return { ...skills };
  }

  let { avg, power, eye } = skills;

  avg = Math.max(0, avg - avg * staminaFactor);
  power = Math.max(0, power - power * staminaFactor);
  eye = Math.max(0, eye - eye * staminaFactor);

  return { ...skills, avg, power, eye };
}
