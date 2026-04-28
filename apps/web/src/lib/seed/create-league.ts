/**
 * League creation pipeline — orchestrates creating a league, teams, players,
 * schedule, and standings in Supabase.
 *
 * Used by:
 * - Seed script (first deployment bootstrap)
 * - Auto-create trigger (when a league fills up)
 * - Admin API route
 */

import { SupabaseClient } from '@supabase/supabase-js';
import { generateRoster, generateTeamName } from './generate-players';
import { generateSchedule } from './generate-schedule';

interface CreateLeagueOptions {
  leagueName?: string;
  division?: string;
  seasonNo?: number;
  teamCount?: number;
  seasonStart?: Date;
}

export interface LeagueCreationResult {
  leagueId: number;
  teamIds: number[];
  playerCount: number;
  scheduleCount: number;
}

/**
 * Create a fully-populated league with AI-controlled teams.
 * Inserts: 1 league, N teams, 40*N players, 50-round schedule, N standings rows.
 *
 * @param supabase - Supabase client (should be a service_role client for RLS bypass)
 * @param options - League configuration
 */
export async function createLeague(
  supabase: SupabaseClient,
  options: CreateLeagueOptions = {},
): Promise<LeagueCreationResult> {
  const {
    leagueName = `League ${Date.now()}`,
    division = 'Premiere',
    seasonNo = 1,
    teamCount = 6,
    seasonStart,
  } = options;

  // 1. Create the league
  const { data: league, error: leagueErr } = await supabase
    .from('leagues')
    .insert({
      league_name: leagueName,
      division,
      season_no: seasonNo,
      max_teams: teamCount,
      status: 'full', // Pre-populated leagues start as full
    })
    .select('id')
    .single();

  if (leagueErr || !league) {
    throw new Error(`Failed to create league: ${leagueErr?.message}`);
  }

  const leagueId = league.id;

  // 2. Create teams
  const teamInserts = Array.from({ length: teamCount }, () => ({
    league_id: leagueId,
    team_name: generateTeamName(),
    country_id: 1,
  }));

  const { data: teams, error: teamsErr } = await supabase
    .from('teams')
    .insert(teamInserts)
    .select('id');

  if (teamsErr || !teams) {
    throw new Error(`Failed to create teams: ${teamsErr?.message}`);
  }

  const teamIds = teams.map((t) => t.id);

  // 3. Generate and insert players for each team
  const allPlayers = teamIds.flatMap((teamId) => {
    const roster = generateRoster();
    return roster.map((p) => ({ ...p, team_id: teamId }));
  });

  // Insert in batches of 100 to stay within Supabase limits
  const BATCH_SIZE = 100;
  let playerCount = 0;
  for (let i = 0; i < allPlayers.length; i += BATCH_SIZE) {
    const batch = allPlayers.slice(i, i + BATCH_SIZE);
    const { error: playersErr } = await supabase.from('players').insert(batch);
    if (playersErr) {
      throw new Error(`Failed to insert players batch ${i}: ${playersErr.message}`);
    }
    playerCount += batch.length;
  }

  // 4. Generate and insert schedule
  const scheduleEntries = generateSchedule(seasonStart);
  const scheduleInserts = scheduleEntries.map((entry) => ({
    league_id: leagueId,
    home_team_id: teamIds[entry.home_team_index],
    visitor_team_id: teamIds[entry.visitor_team_index],
    game_time: entry.game_time.toISOString(),
    game_type: 'regular' as const,
    played: false,
    season_no: seasonNo,
  }));

  // Insert schedule in batches
  let scheduleCount = 0;
  for (let i = 0; i < scheduleInserts.length; i += BATCH_SIZE) {
    const batch = scheduleInserts.slice(i, i + BATCH_SIZE);
    const { error: schedErr } = await supabase.from('schedules').insert(batch);
    if (schedErr) {
      throw new Error(`Failed to insert schedule batch ${i}: ${schedErr.message}`);
    }
    scheduleCount += batch.length;
  }

  // 5. Initialize standings for each team
  const standingsInserts = teamIds.map((teamId) => ({
    league_id: leagueId,
    team_id: teamId,
    season_no: seasonNo,
  }));

  const { error: standErr } = await supabase.from('standings').insert(standingsInserts);
  if (standErr) {
    throw new Error(`Failed to insert standings: ${standErr.message}`);
  }

  return { leagueId, teamIds, playerCount, scheduleCount };
}

/**
 * Create an empty "open" league, ready for human owners to join.
 * No teams, players, or schedule — those are created as users sign up.
 */
export async function createOpenLeague(
  supabase: SupabaseClient,
  options: { leagueName?: string; division?: string; seasonNo?: number } = {},
): Promise<number> {
  const {
    leagueName = `League ${Date.now()}`,
    division = 'Premiere',
    seasonNo = 1,
  } = options;

  const { data, error } = await supabase
    .from('leagues')
    .insert({
      league_name: leagueName,
      division,
      season_no: seasonNo,
      max_teams: 6,
      status: 'open',
    })
    .select('id')
    .single();

  if (error || !data) {
    throw new Error(`Failed to create open league: ${error?.message}`);
  }

  return data.id;
}
