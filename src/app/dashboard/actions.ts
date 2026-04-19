'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';

const FIELD_POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'] as const;
/** Matches field positions and bench codes (B1, B2, … B99) */
const positionRegex = /^(C|1B|2B|3B|SS|LF|CF|RF|DH|B\d{1,2})$/;

const lineupSchema = z.object({
  /** Array of player IDs in batting order (index 0 = batt_order 1) */
  playerIds: z.array(z.number().int().positive()).length(9),
  /** Array of field-position strings matching batting order */
  positions: z.array(z.enum(FIELD_POSITIONS)).length(9),
  /** Bench player IDs (in bench order) */
  benchIds: z.array(z.number().int().positive()).optional(),
});

export async function updateLineup(formData: FormData) {
  const raw = formData.get('playerIds');
  const rawPos = formData.get('positions');
  const rawBench = formData.get('benchIds');
  if (typeof raw !== 'string' || typeof rawPos !== 'string') return { error: 'Invalid data' };

  const parsed = lineupSchema.safeParse({
    playerIds: JSON.parse(raw),
    positions: JSON.parse(rawPos),
    benchIds: rawBench ? JSON.parse(rawBench as string) : [],
  });
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

  // Update batting order and position
  for (let i = 0; i < 9; i++) {
    await supabase
      .from('players')
      .update({ batt_order: i + 1, position: parsed.data.positions[i] })
      .eq('id', parsed.data.playerIds[i]);
  }

  // Set batt_order to 0 and assign Bx positions for bench hitters
  const lineupSet = new Set(parsed.data.playerIds);
  const benchIds = parsed.data.benchIds ?? [];
  const benchSet = new Set(benchIds);

  // Assign B1, B2, B3… to bench players in the order provided
  for (let i = 0; i < benchIds.length; i++) {
    await supabase
      .from('players')
      .update({ batt_order: 0, position: `B${i + 1}` })
      .eq('id', benchIds[i]);
  }

  // Any remaining hitters not in lineup or bench get batt_order 0
  const { data: allHitters } = await supabase
    .from('players')
    .select('id')
    .eq('team_id', team.id)
    .eq('fielder', true);

  for (const h of allHitters ?? []) {
    if (!lineupSet.has(h.id) && !benchSet.has(h.id)) {
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
  /** Array of pitcher IDs for bullpen RP1-RP4 (slots 6-9) */
  bullpenIds: z.array(z.number().int().positive()).max(4),
  /** Pitcher ID for the closer CL (slot 10), or null if unset */
  closerId: z.number().int().positive().nullable().optional(),
});

export async function updateRotation(formData: FormData) {
  const rawPitchers = formData.get('pitcherIds');
  const rawBullpen = formData.get('bullpenIds');
  const rawCloser = formData.get('closerId');
  if (typeof rawPitchers !== 'string' || typeof rawBullpen !== 'string') {
    return { error: 'Invalid data' };
  }

  const parsed = rotationSchema.safeParse({
    pitcherIds: JSON.parse(rawPitchers),
    bullpenIds: JSON.parse(rawBullpen),
    closerId: rawCloser ? JSON.parse(rawCloser as string) : null,
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const closerId = parsed.data.closerId ?? null;
  const totalAssigned = parsed.data.pitcherIds.length + parsed.data.bullpenIds.length + (closerId ? 1 : 0);
  if (totalAssigned !== 10) {
    return { error: `Rotation must have exactly 10 pitchers (5 SP + 4 RP + 1 CL). Currently ${totalAssigned}.` };
  }

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
  const allIds = [...parsed.data.pitcherIds, ...parsed.data.bullpenIds, ...(closerId ? [closerId] : [])];
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

  // Update closer slot (10)
  if (closerId) {
    await supabase
      .from('players')
      .update({ rotation_slot: 10 })
      .eq('id', closerId);
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

const rosterStatusSchema = z.object({
  playerId: z.number().int().positive(),
  newStatus: z.enum(['active', 'reserve']),
});

export async function toggleRosterStatus(formData: FormData) {
  const parsed = rosterStatusSchema.safeParse({
    playerId: Number(formData.get('playerId')),
    newStatus: formData.get('newStatus'),
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

  // Verify player belongs to team and is not a free agent
  const { data: player } = await supabase
    .from('players')
    .select('id, roster_status, fielder')
    .eq('id', parsed.data.playerId)
    .eq('team_id', team.id)
    .single();
  if (!player) return { error: 'Player not found' };
  if (player.roster_status === 'free_agent') return { error: 'Cannot move free agents' };

  // Enforce exactly 15 active position players
  if (parsed.data.newStatus === 'active' && player.fielder) {
    const { count } = await supabase
      .from('players')
      .select('id', { count: 'exact', head: true })
      .eq('team_id', team.id)
      .eq('fielder', true)
      .eq('roster_status', 'active');
    if ((count ?? 0) >= 15) return { error: 'You already have 15 active position players. Move one to reserve first.' };
  }

  // Enforce exactly 10 active pitchers
  if (parsed.data.newStatus === 'active' && !player.fielder) {
    const { count } = await supabase
      .from('players')
      .select('id', { count: 'exact', head: true })
      .eq('team_id', team.id)
      .eq('fielder', false)
      .eq('roster_status', 'active');
    if ((count ?? 0) >= 10) return { error: 'You already have 10 active pitchers. Move one to reserve first.' };
  }

  await supabase
    .from('players')
    .update({ roster_status: parsed.data.newStatus })
    .eq('id', parsed.data.playerId);

  return { success: true };
}

/**
 * Server action: Simulate all remaining unplayed games.
 * Runs server-side so it can use the service client directly.
 */
export async function simAll(): Promise<{ error?: string; message?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  // Delegate to the /api/sim/sim-all route which has maxDuration=300 (5 min)
  // Server actions have a default 30s timeout — too short for 150 games.
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey) return { error: 'Service key not configured' };

  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000';

  const res = await fetch(`${baseUrl}/api/sim/sim-all`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${serviceKey}` },
  });

  const body = await res.json();

  if (!res.ok) {
    return { error: body.error ?? `Sim failed (${res.status})` };
  }

  return { message: body.message ?? `Simulated ${body.simulated} games` };
}

/**
 * Server action: Reset entire season — clear all game data and standings.
 */
export async function resetSeason(): Promise<{ error?: string; message?: string }> {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const service = createServiceClient();

  const deletes = [
    'game_events',
    'game_stats_hitting',
    'game_stats_pitching',
    'player_stats_hitting',
    'player_stats_pitching',
    'games',
  ];

  for (const table of deletes) {
    await service.from(table).delete().gte('id', 0);
  }

  await service
    .from('schedules')
    .update({ played: false })
    .gte('id', 0);

  // Clean up financial transactions from game revenue
  await service.from('financial_transactions').delete().gte('id', 0);

  await service
    .from('standings')
    .update({
      w: 0, l: 0,
      ab: 0, r: 0, h: 0, b2: 0, b3: 0, hr: 0,
      rbi: 0, bb: 0, so: 0, sb: 0, cs: 0, sf: 0, sac: 0,
      era_runs: 0, era_outs: 0,
    })
    .gte('id', 0);

  // Reset starting pitcher rotation to SP1
  await service
    .from('teams')
    .update({ next_sp_slot: 1 })
    .gte('id', 0);

  return { message: 'Season reset complete' };
}
