'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';

const lineupSchema = z.object({
  /** Array of player IDs in batting order (index 0 = batt_order 1) */
  playerIds: z.array(z.number().int().positive()).length(9),
});

export async function updateLineup(formData: FormData) {
  const raw = formData.get('playerIds');
  if (typeof raw !== 'string') return { error: 'Invalid data' };

  const parsed = lineupSchema.safeParse({ playerIds: JSON.parse(raw) });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  // Verify ownership
  const { data: team } = await supabase
    .from('teams')
    .select('id')
    .eq('owner_id', user.id)
    .single();
  if (!team) return { error: 'No team found' };

  // Verify all players belong to this team and are fielders
  const { data: players } = await supabase
    .from('players')
    .select('id')
    .eq('team_id', team.id)
    .eq('fielder', true)
    .in('id', parsed.data.playerIds);

  if (!players || players.length !== 9) {
    return { error: 'Invalid player selection — must be 9 of your active fielders' };
  }

  // Update batting order
  for (let i = 0; i < 9; i++) {
    await supabase
      .from('players')
      .update({ batt_order: i + 1 })
      .eq('id', parsed.data.playerIds[i]);
  }

  // Set batt_order to 0 for all other hitters on the team
  const lineupSet = new Set(parsed.data.playerIds);
  const { data: allHitters } = await supabase
    .from('players')
    .select('id')
    .eq('team_id', team.id)
    .eq('fielder', true);

  for (const h of allHitters ?? []) {
    if (!lineupSet.has(h.id)) {
      await supabase
        .from('players')
        .update({ batt_order: 0 })
        .eq('id', h.id);
    }
  }

  return { success: true };
}

const rotationSchema = z.object({
  /** Array of pitcher IDs for rotation slots 1-5 */
  pitcherIds: z.array(z.number().int().positive()).min(1).max(5),
  /** Array of pitcher IDs for bullpen (slots 6-9) */
  bullpenIds: z.array(z.number().int().positive()).max(4),
});

export async function updateRotation(formData: FormData) {
  const rawPitchers = formData.get('pitcherIds');
  const rawBullpen = formData.get('bullpenIds');
  if (typeof rawPitchers !== 'string' || typeof rawBullpen !== 'string') {
    return { error: 'Invalid data' };
  }

  const parsed = rotationSchema.safeParse({
    pitcherIds: JSON.parse(rawPitchers),
    bullpenIds: JSON.parse(rawBullpen),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const { data: team } = await supabase
    .from('teams')
    .select('id')
    .eq('owner_id', user.id)
    .single();
  if (!team) return { error: 'No team found' };

  // Verify all pitchers belong to this team
  const allIds = [...parsed.data.pitcherIds, ...parsed.data.bullpenIds];
  const { data: pitchers } = await supabase
    .from('players')
    .select('id')
    .eq('team_id', team.id)
    .eq('fielder', false)
    .in('id', allIds);

  if (!pitchers || pitchers.length !== allIds.length) {
    return { error: 'Invalid pitcher selection' };
  }

  // Update rotation slots (1-5)
  for (let i = 0; i < parsed.data.pitcherIds.length; i++) {
    await supabase
      .from('players')
      .update({ rotation_slot: i + 1 })
      .eq('id', parsed.data.pitcherIds[i]);
  }

  // Update bullpen slots (6-9)
  for (let i = 0; i < parsed.data.bullpenIds.length; i++) {
    await supabase
      .from('players')
      .update({ rotation_slot: 6 + i })
      .eq('id', parsed.data.bullpenIds[i]);
  }

  // Set rotation_slot to 0 for all other pitchers
  const assignedSet = new Set(allIds);
  const { data: allTeamPitchers } = await supabase
    .from('players')
    .select('id')
    .eq('team_id', team.id)
    .eq('fielder', false);

  for (const p of allTeamPitchers ?? []) {
    if (!assignedSet.has(p.id)) {
      await supabase
        .from('players')
        .update({ rotation_slot: 0 })
        .eq('id', p.id);
    }
  }

  return { success: true };
}

const jerseySchema = z.object({
  playerId: z.number().int().positive(),
  jerseyNo: z.number().int().min(0).max(99),
});

export async function updateJersey(formData: FormData) {
  const parsed = jerseySchema.safeParse({
    playerId: Number(formData.get('playerId')),
    jerseyNo: Number(formData.get('jerseyNo')),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const { data: team } = await supabase
    .from('teams')
    .select('id')
    .eq('owner_id', user.id)
    .single();
  if (!team) return { error: 'No team found' };

  // Verify player belongs to team
  const { data: player } = await supabase
    .from('players')
    .select('id')
    .eq('id', parsed.data.playerId)
    .eq('team_id', team.id)
    .single();
  if (!player) return { error: 'Player not found' };

  await supabase
    .from('players')
    .update({ jersey_no: parsed.data.jerseyNo })
    .eq('id', parsed.data.playerId);

  return { success: true };
}
