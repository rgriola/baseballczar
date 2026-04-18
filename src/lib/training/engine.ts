/**
 * Training engine — translated from teamTraining.java + TestRandom.java.
 *
 * Original logic:
 *   - training_slot 1-9 maps to one of 9 skills
 *   - Random base improvement: uniform [0.25, 1.25]
 *   - Age factor: 18-22 → 0.04, 23-26 → 0.025, 27-29 → 0.015, 30+ → 0
 *   - improvement = random * ageFactor
 *   - Capped by per-skill max
 *   - Free agents (team_id == null) don't train
 */

import { SupabaseClient } from '@supabase/supabase-js';

/** Training slot → DB column mapping (matches original switch cases 1-9) */
const SLOT_MAP: Record<number, { skill: string; max: string; label: string }> = {
  1: { skill: 'speed',      max: 'max_speed',      label: 'Speed' },
  2: { skill: 'stamina',    max: 'max_stamina',     label: 'Stamina' },
  3: { skill: 'play_intel', max: 'max_play_intel',  label: 'Play Intel' },
  4: { skill: 'avg',        max: 'max_avg',         label: 'Contact' },
  5: { skill: 'strength',   max: 'max_strength',    label: 'Power' },
  6: { skill: 'eye',        max: 'max_eye',         label: 'Eye' },
  7: { skill: 'bunting',    max: 'max_bunting',     label: 'Bunting' },
  8: { skill: 'throw',      max: 'max_throw',       label: 'Throwing' },
  9: { skill: 'fielding',   max: 'max_fielding',    label: 'Fielding' },
};

export { SLOT_MAP };

/** Random float in [0.25, 1.25] — matches TestRandom.trainingImprovement() */
function trainingRandom(): number {
  return 0.25 + Math.random();
}

/** Age-weighted improvement factor — matches original if/else chain */
function ageFactor(age: number): number {
  if (age >= 18 && age <= 22) return 0.04;
  if (age >= 23 && age <= 26) return 0.025;
  if (age >= 27 && age <= 29) return 0.015;
  return 0; // 30+ no improvement
}

export interface TrainingResult {
  playerId: number;
  skill: string;
  oldValue: number;
  newValue: number;
  improvement: number;
  skipped: string | null;
}

/**
 * Run daily training for all eligible players.
 * Must be called with a service-role client.
 */
export async function runDailyTraining(
  supabase: SupabaseClient,
): Promise<TrainingResult[]> {
  // Fetch all players with training assigned (1-9), who belong to a team
  const { data: players, error } = await supabase
    .from('players')
    .select('id, age, training_slot, team_id, speed, stamina, play_intel, avg, strength, eye, bunting, throw, fielding, max_speed, max_stamina, max_play_intel, max_avg, max_strength, max_eye, max_bunting, max_throw, max_fielding')
    .gt('training_slot', 0)
    .lt('training_slot', 10)
    .not('team_id', 'is', null);

  if (error) throw new Error(`Training query failed: ${error.message}`);

  const results: TrainingResult[] = [];

  for (const player of players ?? []) {
    const slot = SLOT_MAP[player.training_slot];
    if (!slot) continue;

    const currentValue = player[slot.skill as keyof typeof player] as number;
    const maxValue = player[slot.max as keyof typeof player] as number;

    // Age check — 30+ no improvement
    const factor = ageFactor(player.age);
    if (factor === 0) {
      results.push({
        playerId: player.id,
        skill: slot.label,
        oldValue: currentValue,
        newValue: currentValue,
        improvement: 0,
        skipped: 'Over 30',
      });
      continue;
    }

    // Max check
    if (currentValue >= maxValue) {
      results.push({
        playerId: player.id,
        skill: slot.label,
        oldValue: currentValue,
        newValue: currentValue,
        improvement: 0,
        skipped: 'Maxed',
      });
      continue;
    }

    // Calculate improvement
    const improvement = trainingRandom() * factor;
    let newValue = currentValue + improvement;

    // Cap at max
    if (newValue > maxValue) {
      newValue = maxValue;
    }

    // Round to 2 decimal places
    newValue = Math.round(newValue * 100) / 100;
    const actualImprovement = Math.round((newValue - currentValue) * 100) / 100;

    // Update DB
    await supabase
      .from('players')
      .update({
        [slot.skill]: newValue,
        improve_factor: actualImprovement,
      })
      .eq('id', player.id);

    results.push({
      playerId: player.id,
      skill: slot.label,
      oldValue: currentValue,
      newValue,
      improvement: actualImprovement,
      skipped: null,
    });
  }

  return results;
}
