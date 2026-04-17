/**
 * New-user team provisioning — creates a team with 40 generated players,
 * joins an open league, and handles league-full auto-creation.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { generateRoster } from '../seed/generate-players';
import { generateSchedule } from '../seed/generate-schedule';
import { createOpenLeague } from '../seed/create-league';

const STARTING_BALANCE = 5_000_000;
const MAX_TEAMS_PER_LEAGUE = 6;

export interface ProvisionResult {
  teamId: number;
  leagueId: number;
  playerCount: number;
  leagueFull: boolean;
}

/**
 * Provision a new team for a user who just signed up.
 *
 * Steps:
 * 1. Find an open league (or create one)
 * 2. Create the team linked to the user
 * 3. Generate 40 players (25 active + 15 reserve)
 * 4. Create standings row
 * 5. Initialize budget
 * 6. If league is now full (6 teams), mark it full + generate schedule + fill AI teams
 *
 * @param supabase - Service-role client (bypasses RLS)
 * @param userId - Auth user ID
 * @param teamName - Team name chosen by user
 */
export async function provisionTeam(
  supabase: SupabaseClient,
  userId: string,
  teamName: string,
): Promise<ProvisionResult> {
  // 1. Find open league
  let { data: openLeague } = await supabase
    .from('leagues')
    .select('id')
    .eq('status', 'open')
    .order('created_at')
    .limit(1)
    .single();

  if (!openLeague) {
    // No open leagues exist — create one
    const newLeagueId = await createOpenLeague(supabase, {
      leagueName: `League ${Date.now()}`,
    });
    openLeague = { id: newLeagueId };
  }

  const leagueId = openLeague.id;

  // 2. Create the team
  const { data: team, error: teamErr } = await supabase
    .from('teams')
    .insert({
      owner_id: userId,
      league_id: leagueId,
      team_name: teamName,
      country_id: 1,
    })
    .select('id')
    .single();

  if (teamErr || !team) {
    throw new Error(`Failed to create team: ${teamErr?.message}`);
  }

  const teamId = team.id;

  // 3. Generate and insert 40 players
  const roster = generateRoster();
  const playerInserts = roster.map((p) => ({ ...p, team_id: teamId }));

  const { error: playersErr } = await supabase
    .from('players')
    .insert(playerInserts);
  if (playersErr) {
    throw new Error(`Failed to insert players: ${playersErr.message}`);
  }

  // 4. Create standings row
  const { error: standErr } = await supabase
    .from('standings')
    .insert({ league_id: leagueId, team_id: teamId, season_no: 1 });
  if (standErr) {
    throw new Error(`Failed to create standings: ${standErr.message}`);
  }

  // 5. Initialize budget
  const { error: budgetErr } = await supabase
    .from('team_budgets')
    .insert({ team_id: teamId, balance: STARTING_BALANCE });
  if (budgetErr) {
    throw new Error(`Failed to create budget: ${budgetErr.message}`);
  }

  // 6. Check if league is now full
  const { count } = await supabase
    .from('teams')
    .select('id', { count: 'exact', head: true })
    .eq('league_id', leagueId);

  let leagueFull = false;

  if (count && count >= MAX_TEAMS_PER_LEAGUE) {
    leagueFull = true;
    await onLeagueFull(supabase, leagueId);
  }

  return { teamId, leagueId, playerCount: roster.length, leagueFull };
}

/**
 * Called when a league reaches capacity. Marks it full,
 * fills remaining slots with AI teams, generates the schedule,
 * and creates a new open league for future signups.
 */
async function onLeagueFull(supabase: SupabaseClient, leagueId: number) {
  // Mark league as full
  await supabase
    .from('leagues')
    .update({ status: 'full' })
    .eq('id', leagueId);

  // Count existing teams
  const { data: existingTeams } = await supabase
    .from('teams')
    .select('id, owner_id')
    .eq('league_id', leagueId);

  const teams = existingTeams ?? [];
  const aiSlotsNeeded = MAX_TEAMS_PER_LEAGUE - teams.length;

  // Fill remaining slots with AI teams
  if (aiSlotsNeeded > 0) {
    const { generateTeamName } = await import('../seed/generate-players');
    const aiTeamInserts = Array.from({ length: aiSlotsNeeded }, () => ({
      league_id: leagueId,
      team_name: generateTeamName(),
      country_id: 1,
    }));

    const { data: aiTeams } = await supabase
      .from('teams')
      .insert(aiTeamInserts)
      .select('id');

    if (aiTeams) {
      for (const aiTeam of aiTeams) {
        const roster = generateRoster();
        const playerInserts = roster.map((p) => ({ ...p, team_id: aiTeam.id }));
        await supabase.from('players').insert(playerInserts);
        await supabase.from('standings').insert({
          league_id: leagueId,
          team_id: aiTeam.id,
          season_no: 1,
        });
        await supabase.from('team_budgets').insert({
          team_id: aiTeam.id,
          balance: STARTING_BALANCE,
        });
      }
      teams.push(...aiTeams.map((t) => ({ id: t.id, owner_id: null })));
    }
  }

  // Generate schedule for all teams in this league
  const allTeamIds = teams.map((t) => t.id);
  if (allTeamIds.length >= 2) {
    const scheduleEntries = generateSchedule();
    const scheduleInserts = scheduleEntries.map((entry) => ({
      league_id: leagueId,
      home_team_id: allTeamIds[entry.home_team_index],
      visitor_team_id: allTeamIds[entry.visitor_team_index],
      game_time: entry.game_time.toISOString(),
      game_type: 'regular' as const,
      played: false,
      season_no: 1,
    }));

    // Insert in batches
    const BATCH = 100;
    for (let i = 0; i < scheduleInserts.length; i += BATCH) {
      await supabase
        .from('schedules')
        .insert(scheduleInserts.slice(i, i + BATCH));
    }
  }

  // Create a new open league for future signups
  await createOpenLeague(supabase, {
    leagueName: `League ${Date.now()}`,
  });
}
