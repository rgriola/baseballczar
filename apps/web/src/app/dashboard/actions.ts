// Last touched by agent: 2026-05-12T08:53:00Z
'use server';

import { z } from 'zod';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { simulateScheduledGame } from '@/lib/sim/simulate-scheduled-game';
import { syncDefaultLineupToSchedule, syncDefaultRotationToSchedule } from '@/lib/lineup/sync-schedule';

const FIELD_POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'] as const;
/** The 8 on-field defensive positions (P is assigned by rotation, not lineup editor) */
const DEFENSIVE_POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF'] as const;
/** Positions where left-handed throwers are not allowed */
const LEFT_THROW_LOCKED = new Set(['C', '2B', '3B', 'SS']);
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

  // ── Position integrity checks ──────────────────────────────────
  const positions = parsed.data.positions;
  const uniquePositions = new Set(positions);
  if (uniquePositions.size !== 9) {
    return { error: 'Each lineup player must have a unique position assignment.' };
  }

  const dhCount = positions.filter((p) => p === 'DH').length;
  if (dhCount !== 1) {
    return { error: 'Lineup must include exactly 1 DH (Designated Hitter).' };
  }

  for (const defPos of DEFENSIVE_POSITIONS) {
    if (!uniquePositions.has(defPos)) {
      return { error: `Lineup is missing defensive position: ${defPos}` };
    }
  }

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
    .select('id, hand_throw')
    .eq('team_id', team.id)
    .eq('fielder', true)
    .in('id', parsed.data.playerIds);

  if (!players || players.length !== 9) {
    return { error: 'Invalid player selection — must be 9 of your active fielders' };
  }

  // Left-hand throw restriction: C, 2B, 3B, SS
  const playerHandMap = new Map(players.map((p) => [p.id, p.hand_throw]));
  for (let i = 0; i < 9; i++) {
    const handThrow = playerHandMap.get(parsed.data.playerIds[i]);
    if (handThrow === 2 && LEFT_THROW_LOCKED.has(positions[i])) {
      return { error: `Left-handed throwers cannot play ${positions[i]}.` };
    }
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

  // Sync the updated default lineup into game_lineups for all unplayed games
  await syncDefaultLineupToSchedule(supabase, team.id);

  return { success: true };
}

const rotationSchema = z.object({
  /** Array of pitcher IDs for rotation slots 1-5 */
  pitcherIds: z.array(z.number().int().positive()).length(5),
  /** Array of pitcher IDs for bullpen RP1-RP4 (slots 6-9) */
  bullpenIds: z.array(z.number().int().positive()).length(4),
  /** Pitcher ID for the closer CL (slot 10) */
  closerId: z.number().int().positive(),
});

export async function updateRotation(formData: FormData) {
  const rawPitchers = formData.get('pitcherIds');
  const rawBullpen = formData.get('bullpenIds');
  const rawCloser = formData.get('closerId');
  if (typeof rawPitchers !== 'string' || typeof rawBullpen !== 'string' || typeof rawCloser !== 'string') {
    return { error: 'Invalid data' };
  }

  const parsed = rotationSchema.safeParse({
    pitcherIds: JSON.parse(rawPitchers),
    bullpenIds: JSON.parse(rawBullpen),
    closerId: JSON.parse(rawCloser),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const closerId = parsed.data.closerId;
  const totalAssigned = parsed.data.pitcherIds.length + parsed.data.bullpenIds.length + 1;
  if (totalAssigned !== 10) {
    return {
      error: `Rotation must include exactly 10 pitchers (5 SP + 4 RP + 1 CL). Currently ${totalAssigned}.`,
    };
  }

  const allIds = [...parsed.data.pitcherIds, ...parsed.data.bullpenIds, closerId];
  if (new Set(allIds).size !== allIds.length) {
    return { error: 'A pitcher cannot be assigned to multiple rotation roles.' };
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
    const slot = 6 + i;
    await supabase
      .from('players')
      .update({ rotation_slot: slot })
      .eq('id', parsed.data.bullpenIds[i]);
  }

  // Update closer slot (10)
  await supabase
    .from('players')
    .update({ rotation_slot: 10 })
    .eq('id', closerId);

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

  // Sync the updated rotation into game_rotation for all unplayed games
  await syncDefaultRotationToSchedule(supabase, team.id);

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

  // Enforce max 12 active pitchers
  if (parsed.data.newStatus === 'active' && !player.fielder) {
    const { count } = await supabase
      .from('players')
      .select('id', { count: 'exact', head: true })
      .eq('team_id', team.id)
      .eq('fielder', false)
      .eq('roster_status', 'active');
    if ((count ?? 0) >= 12) {
      return { error: 'You already have 12 active pitchers. Move one to reserve first.' };
    }
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

  const service = createServiceClient();

  const { data: allGames, error: schedulesError } = await service
    .from('schedules')
    .select('id')
    .eq('played', false)
    .order('game_time');

  if (schedulesError) {
    console.error('Failed to load unplayed schedules for simAll action', schedulesError);
    return { error: 'An internal error occurred' };
  }

  if (!allGames || allGames.length === 0) {
    return { message: 'No games to simulate' };
  }

  let simulated = 0;
  let failed = 0;
  const maxRetries = 2;

  for (let index = 0; index < allGames.length; index++) {
    const game = allGames[index];
    let success = false;

    for (let attempt = 0; attempt <= maxRetries && !success; attempt++) {
      try {
        if (attempt > 0) {
          await new Promise((resolve) => setTimeout(resolve, 500 * attempt));
        }
        await simulateScheduledGame(service, game.id);
        simulated++;
        success = true;
      } catch (err) {
        if (attempt === maxRetries) {
          console.error(`Sim-all action failed schedule ${game.id} after ${maxRetries + 1} attempts`, err);
          failed++;
        }
      }
    }

    if ((index + 1) % 5 === 0) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }

  return {
    message: `Simulated ${simulated} of ${allGames.length} games (${failed} failed)`,
  };
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

  // Ensure every team has a budget row (backfill for teams created before budget system)
  const { data: allTeams } = await service.from('teams').select('id');
  if (allTeams && allTeams.length > 0) {
    const { data: existingBudgets } = await service
      .from('team_budgets')
      .select('team_id');
    const budgetTeamIds = new Set((existingBudgets ?? []).map((b) => b.team_id));
    const missing = allTeams.filter((t) => !budgetTeamIds.has(t.id));
    if (missing.length > 0) {
      await service
        .from('team_budgets')
        .insert(missing.map((t) => ({ team_id: t.id, balance: 5_000_000 })));
    }

    // Reset all budgets to starting balance
    await service
      .from('team_budgets')
      .update({ balance: 5_000_000 })
      .gte('team_id', 0);
  }

  return { message: 'Season reset complete' };
}

// ─── Per-Game Lineup (writes to game_lineups only) ──────────────

const gameLineupSchema = z.object({
  scheduleId: z.number().int().positive(),
  playerIds: z.array(z.number().int().positive()).length(9),
  positions: z.array(z.enum(FIELD_POSITIONS)).length(9),
  benchIds: z.array(z.number().int().positive()).optional(),
});

export async function setGameLineup(formData: FormData) {
  const parsed = gameLineupSchema.safeParse({
    scheduleId: Number(formData.get('scheduleId')),
    playerIds: JSON.parse(formData.get('playerIds') as string ?? '[]'),
    positions: JSON.parse(formData.get('positions') as string ?? '[]'),
    benchIds: JSON.parse(formData.get('benchIds') as string ?? '[]'),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { scheduleId, positions } = parsed.data;

  // Position integrity
  const uniquePositions = new Set(positions);
  if (uniquePositions.size !== 9) return { error: 'Each player must have a unique position.' };
  if (positions.filter((p) => p === 'DH').length !== 1) return { error: 'Must include exactly 1 DH.' };
  for (const defPos of DEFENSIVE_POSITIONS) {
    if (!uniquePositions.has(defPos)) return { error: `Missing defensive position: ${defPos}` };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const { data: team } = await supabase.from('teams').select('id').eq('owner_id', user.id).single();
  if (!team) return { error: 'No team found' };

  // Verify schedule is unplayed and involves this team
  const { data: sched } = await supabase
    .from('schedules')
    .select('id, home_team_id, visitor_team_id, played')
    .eq('id', scheduleId)
    .single();
  if (!sched) return { error: 'Game not found' };
  if (sched.played) return { error: 'Cannot modify lineup for a game already played.' };
  if (sched.home_team_id !== team.id && sched.visitor_team_id !== team.id) {
    return { error: 'This game does not involve your team.' };
  }

  // Verify players belong to team
  const { data: players } = await supabase
    .from('players')
    .select('id, hand_throw')
    .eq('team_id', team.id)
    .eq('fielder', true)
    .in('id', parsed.data.playerIds);
  if (!players || players.length !== 9) return { error: 'Invalid player selection' };

  // Left-hand throw restriction
  const playerHandMap = new Map(players.map((p) => [p.id, p.hand_throw]));
  for (let i = 0; i < 9; i++) {
    const handThrow = playerHandMap.get(parsed.data.playerIds[i]);
    if (handThrow === 2 && LEFT_THROW_LOCKED.has(positions[i])) {
      return { error: `Left-handed throwers cannot play ${positions[i]}.` };
    }
  }

  // Delete existing game_lineups for this schedule + team, then insert fresh
  await supabase
    .from('game_lineups')
    .delete()
    .eq('schedule_id', scheduleId)
    .eq('team_id', team.id);

  const rows: Array<{ schedule_id: number; team_id: number; player_id: number; batt_order: number; position: string }> = parsed.data.playerIds.map((playerId, i) => ({
    schedule_id: scheduleId,
    team_id: team.id,
    player_id: playerId,
    batt_order: i + 1,
    position: positions[i],
  }));

  // Also insert bench players with batt_order 0
  const benchIds = parsed.data.benchIds ?? [];
  for (let i = 0; i < benchIds.length; i++) {
    rows.push({
      schedule_id: scheduleId,
      team_id: team.id,
      player_id: benchIds[i],
      batt_order: 0,
      position: `B${i + 1}`,
    });
  }

  const { error: insertErr } = await supabase.from('game_lineups').insert(rows);
  if (insertErr) return { error: `Failed to save game lineup: ${insertErr.message}` };

  return { success: true };
}

// ─── Per-Game Rotation (writes to game_rotation only) ───────────

const gameRotationSchema = z.object({
  scheduleId: z.number().int().positive(),
  pitcherIds: z.array(z.number().int().positive()).length(5),
  bullpenIds: z.array(z.number().int().positive()).length(4),
  closerId: z.number().int().positive(),
});

export async function setGameRotation(formData: FormData) {
  const parsed = gameRotationSchema.safeParse({
    scheduleId: Number(formData.get('scheduleId')),
    pitcherIds: JSON.parse(formData.get('pitcherIds') as string ?? '[]'),
    bullpenIds: JSON.parse(formData.get('bullpenIds') as string ?? '[]'),
    closerId: Number(formData.get('closerId')),
  });
  if (!parsed.success) return { error: parsed.error.issues[0].message };

  const { scheduleId, closerId } = parsed.data;
  const allIds = [...parsed.data.pitcherIds, ...parsed.data.bullpenIds, closerId];
  if (new Set(allIds).size !== allIds.length) {
    return { error: 'A pitcher cannot be assigned to multiple roles.' };
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: 'Not authenticated' };

  const { data: team } = await supabase.from('teams').select('id').eq('owner_id', user.id).single();
  if (!team) return { error: 'No team found' };

  // Verify schedule
  const { data: sched } = await supabase
    .from('schedules')
    .select('id, home_team_id, visitor_team_id, played')
    .eq('id', scheduleId)
    .single();
  if (!sched) return { error: 'Game not found' };
  if (sched.played) return { error: 'Cannot modify rotation for a game already played.' };
  if (sched.home_team_id !== team.id && sched.visitor_team_id !== team.id) {
    return { error: 'This game does not involve your team.' };
  }

  // Verify pitchers belong to team
  const { data: pitchers } = await supabase
    .from('players')
    .select('id')
    .eq('team_id', team.id)
    .eq('fielder', false)
    .in('id', allIds);
  if (!pitchers || pitchers.length !== allIds.length) return { error: 'Invalid pitcher selection' };

  // Delete existing game_rotation for this schedule + team, then insert fresh
  await supabase
    .from('game_rotation')
    .delete()
    .eq('schedule_id', scheduleId)
    .eq('team_id', team.id);

  const rows: Array<{ schedule_id: number; team_id: number; player_id: number; rotation_slot: number }> = [];
  for (let i = 0; i < parsed.data.pitcherIds.length; i++) {
    rows.push({ schedule_id: scheduleId, team_id: team.id, player_id: parsed.data.pitcherIds[i], rotation_slot: i + 1 });
  }
  for (let i = 0; i < parsed.data.bullpenIds.length; i++) {
    rows.push({ schedule_id: scheduleId, team_id: team.id, player_id: parsed.data.bullpenIds[i], rotation_slot: 6 + i });
  }
  rows.push({ schedule_id: scheduleId, team_id: team.id, player_id: closerId, rotation_slot: 10 });

  const { error: insertErr } = await supabase.from('game_rotation').insert(rows);
  if (insertErr) return { error: `Failed to save game rotation: ${insertErr.message}` };

  return { success: true };
}
