/**
 * Backfill lineup gaps — ensures a team always has 9 hitters
 * with batt_order 1-9.  Call after any roster-modifying operation
 * (release, trade, etc.) that may remove a lineup player.
 */
import { SupabaseClient } from '@supabase/supabase-js';

export async function backfillLineup(supabase: SupabaseClient, teamId: number) {
  // Get current lineup (batt_order 1-9)
  const { data: lineup } = await supabase
    .from('players')
    .select('id, batt_order')
    .eq('team_id', teamId)
    .eq('fielder', true)
    .eq('roster_status', 'active')
    .gte('batt_order', 1)
    .lte('batt_order', 9)
    .order('batt_order');

  const filled = lineup ?? [];
  if (filled.length >= 9) return; // already full

  // Find which slots 1-9 are taken
  const usedSlots = new Set(filled.map((p) => p.batt_order));
  const emptySlots: number[] = [];
  for (let s = 1; s <= 9; s++) {
    if (!usedSlots.has(s)) emptySlots.push(s);
  }

  if (emptySlots.length === 0) return;

  // Grab bench hitters (batt_order 0 or >9) to promote
  const lineupIds = filled.map((p) => p.id);
  const { data: bench } = await supabase
    .from('players')
    .select('id')
    .eq('team_id', teamId)
    .eq('fielder', true)
    .eq('roster_status', 'active')
    .not('id', 'in', lineupIds.length > 0 ? `(${lineupIds.join(',')})` : '(0)')
    .limit(emptySlots.length);

  if (!bench || bench.length === 0) return;

  // Assign bench players to empty slots
  for (let i = 0; i < Math.min(bench.length, emptySlots.length); i++) {
    await supabase
      .from('players')
      .update({ batt_order: emptySlots[i] })
      .eq('id', bench[i].id);
  }
}
