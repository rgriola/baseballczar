/**
 * POST /api/challenges/send — Send an O2O challenge to another team
 *
 * Body: { challengedTeamId: number, wager?: number }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireMyTeam } from '@/lib/queries/team';
import { sendNotification } from '@/lib/notifications';
import { checkBudget } from '@/lib/finance';
import { z } from 'zod';

const SendSchema = z.object({
  challengedTeamId: z.number().int().positive(),
  wager: z.number().int().min(0).max(500000).default(0),
});

const COOLDOWN_DAYS = 7;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = SendSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { challengedTeamId, wager } = parsed.data;
  const supabase = await createClient();
  const team = await requireMyTeam();

  if (challengedTeamId === team.id) {
    return NextResponse.json({ error: 'Cannot challenge yourself' }, { status: 400 });
  }

  // Verify challenged team exists
  const { data: opponent } = await supabase
    .from('teams')
    .select('id, team_name, owner_id')
    .eq('id', challengedTeamId)
    .single();

  if (!opponent) {
    return NextResponse.json({ error: 'Team not found' }, { status: 404 });
  }

  // Cooldown check — no challenge between same teams within 7 days
  const cooldownDate = new Date();
  cooldownDate.setDate(cooldownDate.getDate() - COOLDOWN_DAYS);

  const { data: recent } = await supabase
    .from('challenge_requests')
    .select('id')
    .or(
      `and(challenger_team_id.eq.${team.id},challenged_team_id.eq.${challengedTeamId}),and(challenger_team_id.eq.${challengedTeamId},challenged_team_id.eq.${team.id})`,
    )
    .gte('created_at', cooldownDate.toISOString())
    .in('status', ['pending', 'accepted', 'completed'])
    .limit(1);

  if (recent && recent.length > 0) {
    return NextResponse.json(
      { error: `Cooldown: cannot challenge this team again within ${COOLDOWN_DAYS} days` },
      { status: 400 },
    );
  }

  // Budget check for wager
  if (wager > 0) {
    const budgetCheck = await checkBudget(supabase, team.id, wager);
    if (!budgetCheck.ok) {
      return NextResponse.json({ error: 'Insufficient funds for wager' }, { status: 400 });
    }
  }

  // Create challenge
  const { data: challenge, error } = await supabase
    .from('challenge_requests')
    .insert({
      challenger_team_id: team.id,
      challenged_team_id: challengedTeamId,
      wager,
    })
    .select('id')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Notify challenged team owner
  if (opponent.owner_id) {
    await sendNotification(supabase, opponent.owner_id, 'challenge_received', {
      message: `${team.team_name} has challenged you to an O2O game${wager > 0 ? ` (wager: $${wager.toLocaleString()})` : ''}!`,
      challengeId: challenge?.id,
      challengerTeamName: team.team_name,
      wager,
    });
  }

  return NextResponse.json({ success: true, challengeId: challenge?.id });
}
