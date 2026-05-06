// Last touched by agent: 2026-05-05T17:09:42Z
/**
 * Shared data-fetching helpers for dashboard pages.
 * All use the server Supabase client (cookies-based auth).
 */

import { createClient } from '@/lib/supabase/server';
import { getSessionUser } from '@/lib/supabase/session-user';

/** Get the current user's team. Returns null if user has no team. */
export async function getMyTeam() {
  const user = await getSessionUser();
  if (!user) return null;

  const supabase = await createClient();
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
