import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { provisionTeam } from '@/lib/provisioning';

/**
 * POST /api/provision
 * Fallback route: if user has no team, provision one.
 * Called from the dashboard when team is missing.
 */
export async function POST() {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
  }

  // Check if user already has a team
  const { data: existingTeam } = await supabase
    .from('teams')
    .select('id')
    .eq('owner_id', user.id)
    .single();

  if (existingTeam) {
    return NextResponse.json({ error: 'Team already exists', teamId: existingTeam.id });
  }

  const teamName = user.user_metadata?.team_name ?? `Team ${user.id.slice(0, 6)}`;

  try {
    const serviceClient = createServiceClient();
    const result = await provisionTeam(serviceClient, user.id, teamName);
    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
