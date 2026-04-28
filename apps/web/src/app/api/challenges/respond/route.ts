/**
 * POST /api/challenges/respond — Accept or decline a challenge
 *
 * On accept: creates an O2O schedule entry and updates status.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireMyTeam } from '@/lib/queries/team';
import { sendNotification } from '@/lib/notifications';
import { checkBudget } from '@/lib/finance';
import { z } from 'zod';

const RespondSchema = z.object({
  challengeId: z.number().int().positive(),
  action: z.enum(['accept', 'decline']),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = RespondSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { challengeId, action } = parsed.data;
  const supabase = await createClient();
  const team = await requireMyTeam();

  // Load challenge
  const { data: challenge } = await supabase
    .from('challenge_requests')
    .select('id, challenger_team_id, challenged_team_id, wager, status')
    .eq('id', challengeId)
    .eq('status', 'pending')
    .single();

  if (!challenge) {
    return NextResponse.json({ error: 'Challenge not found or already resolved' }, { status: 404 });
  }

  // Only the challenged team can respond
  if (challenge.challenged_team_id !== team.id) {
    return NextResponse.json({ error: 'Not authorized' }, { status: 403 });
  }

  // Get challenger info for notifications
  const { data: challengerTeam } = await supabase
    .from('teams')
    .select('id, team_name, owner_id, league_id')
    .eq('id', challenge.challenger_team_id)
    .single();

  if (action === 'decline') {
    await supabase
      .from('challenge_requests')
      .update({ status: 'declined' })
      .eq('id', challengeId);

    if (challengerTeam?.owner_id) {
      await sendNotification(supabase, challengerTeam.owner_id, 'challenge_declined', {
        message: `${team.team_name} has declined your O2O challenge.`,
        challengeId,
      });
    }

    return NextResponse.json({ success: true, action: 'declined' });
  }

  // Accept — verify budget for wager
  if (challenge.wager > 0) {
    const budgetCheck = await checkBudget(supabase, team.id, challenge.wager);
    if (!budgetCheck.ok) {
      return NextResponse.json({ error: 'Insufficient funds for wager' }, { status: 400 });
    }
  }

  // Create O2O schedule entry — challenger is visitor, challenged is home
  const gameTime = new Date();
  gameTime.setHours(gameTime.getHours() + 1); // scheduled 1 hour from now

  const { data: schedule, error: schedErr } = await supabase
    .from('schedules')
    .insert({
      league_id: challengerTeam?.league_id ?? 1,
      home_team_id: challenge.challenged_team_id,
      visitor_team_id: challenge.challenger_team_id,
      game_time: gameTime.toISOString(),
      game_type: 'o2o',
      season_no: 1,
    })
    .select('id')
    .single();

  if (schedErr) {
    return NextResponse.json({ error: schedErr.message }, { status: 500 });
  }

  // Update challenge status
  await supabase
    .from('challenge_requests')
    .update({ status: 'accepted' })
    .eq('id', challengeId);

  // Notify challenger
  if (challengerTeam?.owner_id) {
    await sendNotification(supabase, challengerTeam.owner_id, 'challenge_accepted', {
      message: `${team.team_name} has accepted your O2O challenge! Game scheduled.`,
      challengeId,
      scheduleId: schedule?.id,
    });
  }

  return NextResponse.json({ success: true, action: 'accepted', scheduleId: schedule?.id });
}
