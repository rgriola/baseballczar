/**
 * Populate game_lineups and game_rotation for a team's unplayed games.
 *
 * Copies the current "default" lineup (from players.batt_order/position)
 * and rotation (from players.rotation_slot) into the per-game tables
 * for all unplayed schedule entries involving this team.
 *
 * Call after:
 *  - updateLineup() — to sync the default into all unplayed games
 *  - updatePitchingStaff() — same
 *  - backfillLineup() — after trade/release heals the default
 *  - createLeague() — after schedule generation
 */
import { SupabaseClient } from '@supabase/supabase-js';

/**
 * Sync the default lineup from `players` into `game_lineups` for all
 * unplayed schedule entries involving the given team.
 */
export async function syncDefaultLineupToSchedule(
  supabase: SupabaseClient,
  teamId: number,
) {
  // 1. Load the current default lineup (hitters with batt_order >= 0)
  const { data: hitters } = await supabase
    .from('players')
    .select('id, batt_order, position')
    .eq('team_id', teamId)
    .eq('fielder', true)
    .eq('roster_status', 'active');

  if (!hitters || hitters.length === 0) return;

  // 2. Find all unplayed schedules involving this team
  const { data: schedules } = await supabase
    .from('schedules')
    .select('id')
    .eq('played', false)
    .or(`home_team_id.eq.${teamId},visitor_team_id.eq.${teamId}`);

  if (!schedules || schedules.length === 0) return;

  // 3. Upsert into game_lineups for each schedule entry
  const rows = schedules.flatMap((s) =>
    hitters.map((h) => ({
      schedule_id: s.id,
      team_id: teamId,
      player_id: h.id,
      batt_order: h.batt_order,
      position: h.position,
    })),
  );

  // Insert in batches (Supabase has row limits)
  const BATCH_SIZE = 500;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await supabase
      .from('game_lineups')
      .upsert(batch, { onConflict: 'schedule_id,team_id,player_id' });
  }
}

/**
 * Sync the default pitching rotation from `players` into `game_rotation`
 * for all unplayed schedule entries involving the given team.
 */
export async function syncDefaultRotationToSchedule(
  supabase: SupabaseClient,
  teamId: number,
) {
  // 1. Load the current rotation (pitchers with rotation_slot > 0)
  const { data: pitchers } = await supabase
    .from('players')
    .select('id, rotation_slot')
    .eq('team_id', teamId)
    .eq('fielder', false)
    .eq('roster_status', 'active')
    .gt('rotation_slot', 0);

  if (!pitchers || pitchers.length === 0) return;

  // 2. Find all unplayed schedules involving this team
  const { data: schedules } = await supabase
    .from('schedules')
    .select('id')
    .eq('played', false)
    .or(`home_team_id.eq.${teamId},visitor_team_id.eq.${teamId}`);

  if (!schedules || schedules.length === 0) return;

  // 3. Upsert into game_rotation for each schedule entry
  const rows = schedules.flatMap((s) =>
    pitchers.map((p) => ({
      schedule_id: s.id,
      team_id: teamId,
      player_id: p.id,
      rotation_slot: p.rotation_slot,
    })),
  );

  const BATCH_SIZE = 500;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await supabase
      .from('game_rotation')
      .upsert(batch, { onConflict: 'schedule_id,team_id,player_id' });
  }
}

/**
 * Convenience: sync both lineup + rotation for a team.
 */
export async function syncDefaultsToSchedule(
  supabase: SupabaseClient,
  teamId: number,
) {
  await syncDefaultLineupToSchedule(supabase, teamId);
  await syncDefaultRotationToSchedule(supabase, teamId);
}
