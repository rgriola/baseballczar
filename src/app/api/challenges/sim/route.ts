/**
 * POST /api/challenges/sim — Simulate an accepted O2O challenge game
 *
 * Protected by service-role key (called by worker/cron or manually).
 * Also settles the wager + gate receipts and updates o2o_records.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { simulateScheduledGame } from '@/lib/sim';
import { calculateGameRevenue } from '@/lib/sim-engine/GateReceipts';
import { safeDebit, safeCredit } from '@/lib/finance';
import { sendNotification } from '@/lib/notifications';
import { z } from 'zod';

const SimSchema = z.object({
  challengeId: z.number().int().positive(),
});

export async function POST(req: NextRequest) {
  // Service key check
  const authHeader = req.headers.get('authorization');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json();
  const parsed = SimSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const supabase = createServiceClient();

  // Load challenge
  const { data: challenge } = await supabase
    .from('challenge_requests')
    .select('id, challenger_team_id, challenged_team_id, wager, status')
    .eq('id', parsed.data.challengeId)
    .eq('status', 'accepted')
    .single();

  if (!challenge) {
    return NextResponse.json({ error: 'Challenge not found or not accepted' }, { status: 404 });
  }

  // Find the O2O schedule entry
  const { data: sched } = await supabase
    .from('schedules')
    .select('id')
    .eq('home_team_id', challenge.challenged_team_id)
    .eq('visitor_team_id', challenge.challenger_team_id)
    .eq('game_type', 'o2o')
    .eq('played', false)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (!sched) {
    return NextResponse.json({ error: 'No unplayed O2O schedule found' }, { status: 404 });
  }

  // Simulate the game
  const result = await simulateScheduledGame(supabase, sched.id);

  // Gate receipts (O2O rates: home $35K, visitor $3K)
  const revenue = calculateGameRevenue('o2o');
  const homeTeamId = challenge.challenged_team_id;
  const visitorTeamId = challenge.challenger_team_id;

  const homeTotal =
    revenue.homeReceipts + revenue.homeFoodBev + revenue.homeAds + revenue.homeStadiumOps;

  await safeCredit(supabase, homeTeamId, homeTotal, 'gate_receipts', 'O2O home gate receipts', result.gameId);
  await safeCredit(supabase, visitorTeamId, revenue.visitorReceipts, 'gate_receipts', 'O2O visitor receipts', result.gameId);

  // Settle wager
  if (challenge.wager > 0) {
    const winnerId = result.winningTeamId;
    const loserId = winnerId === homeTeamId ? visitorTeamId : homeTeamId;

    await safeCredit(supabase, winnerId, challenge.wager, 'wager_won', 'O2O wager won', result.gameId);
    await safeDebit(supabase, loserId, challenge.wager, 'wager_lost', 'O2O wager lost', result.gameId);
  }

  // Update o2o_records (upsert)
  // Always store with smaller team_id as team_a for consistency
  const teamA = Math.min(homeTeamId, visitorTeamId);
  const teamB = Math.max(homeTeamId, visitorTeamId);
  const winnerIsA = result.winningTeamId === teamA;

  const { data: existing } = await supabase
    .from('o2o_records')
    .select('id, wins_a, wins_b')
    .eq('team_a_id', teamA)
    .eq('team_b_id', teamB)
    .maybeSingle();

  if (existing) {
    await supabase
      .from('o2o_records')
      .update({
        wins_a: existing.wins_a + (winnerIsA ? 1 : 0),
        wins_b: existing.wins_b + (winnerIsA ? 0 : 1),
        updated_at: new Date().toISOString(),
      })
      .eq('id', existing.id);
  } else {
    await supabase.from('o2o_records').insert({
      team_a_id: teamA,
      team_b_id: teamB,
      wins_a: winnerIsA ? 1 : 0,
      wins_b: winnerIsA ? 0 : 1,
    });
  }

  // Mark challenge completed with game_id
  await supabase
    .from('challenge_requests')
    .update({ status: 'completed', game_id: result.gameId })
    .eq('id', challenge.id);

  // Notify both teams
  const teamIds = [homeTeamId, visitorTeamId];
  for (const tid of teamIds) {
    const { data: t } = await supabase.from('teams').select('owner_id, team_name').eq('id', tid).single();
    if (t?.owner_id) {
      const won = result.winningTeamId === tid;
      await sendNotification(supabase, t.owner_id, 'game_result', {
        message: `O2O result: ${won ? 'WIN' : 'LOSS'} — ${result.visitorRuns}-${result.homeRuns}${challenge.wager > 0 ? ` (${won ? '+' : '-'}$${challenge.wager.toLocaleString()} wager)` : ''}`,
        gameId: result.gameId,
        challengeId: challenge.id,
      });
    }
  }

  return NextResponse.json({
    success: true,
    gameId: result.gameId,
    score: `${result.visitorRuns}-${result.homeRuns}`,
    winnerId: result.winningTeamId,
  });
}
