/**
 * Backfill lineup gaps — ensures a team always has 9 hitters
 * with batt_order 1-9 and valid defensive positions.
 *
 * Call after any roster-modifying operation (release, trade, etc.)
 * that may remove a lineup player.
 */
import { SupabaseClient } from '@supabase/supabase-js';
import { syncDefaultLineupToSchedule } from './sync-schedule';

/** The 8 on-field defensive positions + DH (P is assigned by rotation) */
const ALL_LINEUP_POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'] as const;

/** Preferred assignment order when auto-assigning a position to a promoted
 *  bench player: DH first (no fielding impact), then OF, then IF. */
const POSITION_PREFER_ORDER = ['DH', 'RF', 'LF', 'CF', '1B', '3B', '2B', 'SS', 'C'] as const;

export async function backfillLineup(supabase: SupabaseClient, teamId: number) {
  // Get current lineup (batt_order 1-9) including their position
  const { data: lineup } = await supabase
    .from('players')
    .select('id, batt_order, position')
    .eq('team_id', teamId)
    .eq('fielder', true)
    .eq('roster_status', 'active')
    .gte('batt_order', 1)
    .lte('batt_order', 9)
    .order('batt_order');

  const filled = lineup ?? [];
  if (filled.length >= 9) return; // already full

  // Find which batting order slots 1-9 are taken
  const usedSlots = new Set(filled.map((p) => p.batt_order));
  const emptySlots: number[] = [];
  for (let s = 1; s <= 9; s++) {
    if (!usedSlots.has(s)) emptySlots.push(s);
  }

  if (emptySlots.length === 0) return;

  // Collect which defensive positions are already occupied by the lineup
  const usedPositions = new Set(
    filled
      .map((p) => p.position as string)
      .filter((pos) => ALL_LINEUP_POSITIONS.includes(pos as typeof ALL_LINEUP_POSITIONS[number])),
  );

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

  // Assign bench players to empty slots WITH a valid defensive position
  for (let i = 0; i < Math.min(bench.length, emptySlots.length); i++) {
    // Pick the first unused position in preference order
    const position = POSITION_PREFER_ORDER.find((p) => !usedPositions.has(p)) ?? 'DH';
    usedPositions.add(position);

    await supabase
      .from('players')
      .update({ batt_order: emptySlots[i], position })
      .eq('id', bench[i].id);
  }

  // Sync the healed default lineup into game_lineups for all unplayed games
  await syncDefaultLineupToSchedule(supabase, teamId);
}
