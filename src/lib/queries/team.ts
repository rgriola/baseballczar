/**
 * Shared data-fetching helpers for dashboard pages.
 * All use the server Supabase client (cookies-based auth).
 */

import { createClient } from '@/lib/supabase/server';

/** Get the current user's team. Returns null if user has no team. */
export async function getMyTeam() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: team } = await supabase
    .from('teams')
    .select('*')
    .eq('owner_id', user.id)
    .single();

  return team;
}

/** Get the current user's team ID. Throws if no team found. */
export async function requireMyTeam() {
  const team = await getMyTeam();
  if (!team) throw new Error('No team found for current user');
  return team;
}
