import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createServiceClient } from '@/lib/supabase/service';
import { provisionTeam } from '@/lib/provisioning';

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/dashboard';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Auto-provision team if user confirmed email and doesn't have one
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const { data: existingTeam } = await supabase
          .from('teams')
          .select('id')
          .eq('owner_id', user.id)
          .single();

        if (!existingTeam) {
          try {
            const serviceClient = createServiceClient();
            const teamName = user.user_metadata?.team_name ?? `Team ${user.id.slice(0, 6)}`;
            await provisionTeam(serviceClient, user.id, teamName);
          } catch (e) {
            console.error('Auto-provision on callback failed:', e);
          }
        }
      }

      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_error`);
}
