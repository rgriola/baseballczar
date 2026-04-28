/**
 * Simulate a single scheduled game — loads rosters from Supabase,
 * runs the sim engine, and persists all results.
 *
 * Used by: API routes, BullMQ worker, scheduler.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { simulateGame, type TeamInput, type LineupPlayer, type BullpenPitcher } from '../sim-engine/GameEngine';
import type { PlayerSkills, PitcherAttributes } from '../sim-engine/types';
import { persistGameResult } from './persist-game';

interface SimulateScheduledGameResult {
  gameId: number;
  homeRuns: number;
  visitorRuns: number;
  winningTeamId: number;
}

/**
 * Simulate a game from a schedule entry.
 * @param supabase - Service-role Supabase client
 * @param scheduleId - The schedule row to simulate
 */
export async function simulateScheduledGame(
  supabase: SupabaseClient,
  scheduleId: number,
): Promise<SimulateScheduledGameResult> {
  // 1. Fetch schedule entry
  const { data: sched, error: schedErr } = await supabase
    .from('schedules')
    .select('id, league_id, home_team_id, visitor_team_id, game_type, season_no, played')
    .eq('id', scheduleId)
    .single();

  if (schedErr || !sched) {
    throw new Error(`Schedule ${scheduleId} not found: ${schedErr?.message}`);
  }
  if (sched.played) {
    throw new Error(`Schedule ${scheduleId} already played`);
  }

  // 2. Load team data (including next_sp_slot for rotation tracking)
  const { data: homeTeam } = await supabase
    .from('teams')
    .select('id, team_name, next_sp_slot')
    .eq('id', sched.home_team_id)
    .single();

  const { data: visitorTeam } = await supabase
    .from('teams')
    .select('id, team_name, next_sp_slot')
    .eq('id', sched.visitor_team_id)
    .single();

  if (!homeTeam || !visitorTeam) {
    throw new Error('Could not load teams');
  }

  // 3. Load rosters (pass next_sp_slot so the correct starter is chosen)
  const homeInput = await buildTeamInput(supabase, homeTeam.id, homeTeam.team_name, homeTeam.next_sp_slot ?? 1);
  const visitorInput = await buildTeamInput(supabase, visitorTeam.id, visitorTeam.team_name, visitorTeam.next_sp_slot ?? 1);

  // 4. Run simulation
  const result = simulateGame(visitorInput.teamInput, homeInput.teamInput);

  // 5. Persist
  const gameId = await persistGameResult(supabase, result, {
    scheduleId: sched.id,
    leagueId: sched.league_id,
    seasonNo: sched.season_no,
    gameType: sched.game_type,
    homeHitterMeta: homeInput.hitterMeta,
    visitorHitterMeta: visitorInput.hitterMeta,
    homePitcherMeta: homeInput.pitcherMeta,
    visitorPitcherMeta: visitorInput.pitcherMeta,
  });

  // 6. Advance starting pitcher rotation (SP1→SP2→…→SP5→SP1)
  const homeNextSlot = ((homeTeam.next_sp_slot ?? 1) % 5) + 1;
  const visitorNextSlot = ((visitorTeam.next_sp_slot ?? 1) % 5) + 1;
  await supabase.from('teams').update({ next_sp_slot: homeNextSlot }).eq('id', homeTeam.id);
  await supabase.from('teams').update({ next_sp_slot: visitorNextSlot }).eq('id', visitorTeam.id);

  return {
    gameId,
    homeRuns: result.homeRuns,
    visitorRuns: result.visitorRuns,
    winningTeamId: result.winningTeamId,
  };
}

// ─── Roster loading ──────────────────────────────────────────

interface TeamBuild {
  teamInput: TeamInput;
  hitterMeta: Map<number, { teamId: number; position: string; batOrder: number }>;
  pitcherMeta: Map<number, { teamId: number }>;
}

async function buildTeamInput(
  supabase: SupabaseClient,
  teamId: number,
  teamName: string,
  nextSpSlot: number,
): Promise<TeamBuild> {
  // Load active hitters (ordered by batt_order)
  const { data: hitters, error: hErr } = await supabase
    .from('players')
    .select('id, first_name, last_name, jersey_no, position, batt_order, speed, ag, eye, avg, strength, dhr')
    .eq('team_id', teamId)
    .eq('fielder', true)
    .eq('roster_status', 'active')
    .gte('batt_order', 1)
    .lte('batt_order', 9)
    .order('batt_order');

  // If fewer than 9 lineup hitters, pull bench players to fill
  let finalHitters = hitters ?? [];
  if (!hErr && finalHitters.length < 9) {
    const needed = 9 - finalHitters.length;
    const existingIds = finalHitters.map((h) => h.id);
    const { data: bench } = await supabase
      .from('players')
      .select('id, first_name, last_name, jersey_no, position, batt_order, speed, ag, eye, avg, strength, dhr')
      .eq('team_id', teamId)
      .eq('fielder', true)
      .eq('roster_status', 'active')
      .not('id', 'in', `(${existingIds.join(',')})`)
      .limit(needed);
    if (bench && bench.length > 0) {
      finalHitters = [...finalHitters, ...bench];
    }
  }

  if (hErr || finalHitters.length < 9) {
    throw new Error(`Team ${teamId} has insufficient lineup hitters (${finalHitters.length})`);
  }

  // Load pitchers (rotation slots 1-10: SP1-5, RP1-4, CL)
  const { data: pitchers, error: pErr } = await supabase
    .from('players')
    .select('id, first_name, last_name, jersey_no, rotation_slot, speed, stamina, ag, eye, avg, strength, dhr, play_intel')
    .eq('team_id', teamId)
    .eq('fielder', false)
    .eq('roster_status', 'active')
    .gt('rotation_slot', 0)
    .lte('rotation_slot', 10)
    .order('rotation_slot');

  if (pErr || !pitchers || pitchers.length < 1) {
    throw new Error(`Team ${teamId} has no active pitchers`);
  }

  // Identify today's starting pitcher by next_sp_slot
  const starterSlot = Math.max(1, Math.min(5, nextSpSlot)); // clamp 1-5
  const starterPitcher = pitchers.find((p) => p.rotation_slot === starterSlot);
  // Fallback: if the designated slot is empty, use the first available SP
  const actualStarter = starterPitcher ?? pitchers.find((p) => p.rotation_slot >= 1 && p.rotation_slot <= 5);

  if (!actualStarter) {
    throw new Error(`Team ${teamId} has no starting pitcher for slot SP${starterSlot}`);
  }

  // Separate relievers (RP slots 6-9) and closer (slot 10)
  const relievers = pitchers.filter((p) => p.rotation_slot >= 6 && p.rotation_slot <= 9);
  const closerPitcher = pitchers.find((p) => p.rotation_slot === 10);

  // Build lineup
  const lineup: LineupPlayer[] = finalHitters.slice(0, 9).map((h) => ({
    playerId: h.id,
    jerseyNo: h.jersey_no,
    lastName: h.last_name,
    skills: {
      ag: h.ag,
      avg: h.avg,
      power: h.strength,
      eye: h.eye,
      dhr: h.dhr,
      speed: h.speed,
    } as PlayerSkills,
  }));

  // Build bullpen array: [0] = starter, [1..N-1] = relievers, [last] = closer
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function toBullpenEntry(p: any, isStarter: boolean, isCloser: boolean): BullpenPitcher {
    return {
      playerId: p.id,
      jerseyNo: p.jersey_no,
      lastName: p.last_name,
      skills: {
        ag: p.ag,
        avg: p.avg,
        power: p.strength,
        eye: p.eye,
        dhr: p.dhr,
        speed: p.speed,
        stamina: p.stamina,
        pitchIntel: p.play_intel,
      } as PitcherAttributes,
      isStarter,
      isCloser,
    };
  }

  const bullpen: BullpenPitcher[] = [
    toBullpenEntry(actualStarter, true, false),
    ...relievers.map((p) => toBullpenEntry(p, false, false)),
    ...(closerPitcher ? [toBullpenEntry(closerPitcher, false, true)] : []),
  ];

  // Build metadata maps
  const hitterMeta = new Map<number, { teamId: number; position: string; batOrder: number }>();
  for (const h of finalHitters.slice(0, 9)) {
    hitterMeta.set(h.id, { teamId, position: h.position, batOrder: h.batt_order });
  }

  const pitcherMeta = new Map<number, { teamId: number }>();
  for (const p of pitchers) {
    pitcherMeta.set(p.id, { teamId });
  }

  return {
    teamInput: { teamId, teamName, lineup, bullpen },
    hitterMeta,
    pitcherMeta,
  };
}
