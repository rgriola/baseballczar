/**
 * POST /api/market/sign
 *
 * Sign a free agent to the authenticated user's team.
 * Validates: ownership, roster capacity, budget sufficiency.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireMyTeam } from '@/lib/queries/team';
import { checkBudget, safeDebit, playerValueFromRow } from '@/lib/finance';
import { countRoster, canAddPlayer } from '@/lib/provisioning';
import { z } from 'zod';

const SignSchema = z.object({
  playerId: z.number().int().positive(),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = SignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 },
    );
  }

  const { playerId } = parsed.data;
  const supabase = await createClient();
  const team = await requireMyTeam();

  // 1. Verify player is a free agent
  const { data: player, error: playerErr } = await supabase
    .from('players')
    .select('id, first_name, last_name, roster_status, team_id, salary, fielder, speed, stamina, play_intel, avg, strength, eye, bunting, throw, fielding')
    .eq('id', playerId)
    .single();

  if (playerErr || !player) {
    return NextResponse.json({ error: 'Player not found' }, { status: 404 });
  }
  if (player.roster_status !== 'free_agent') {
    return NextResponse.json({ error: 'Player is not a free agent' }, { status: 400 });
  }

  // 2. Check roster capacity
  const { data: roster } = await supabase
    .from('players')
    .select('fielder, roster_status')
    .eq('team_id', team.id)
    .in('roster_status', ['active', 'reserve']);

  const counts = countRoster(roster ?? []);
  const rosterCheck = canAddPlayer(counts);
  if (!rosterCheck.valid) {
    return NextResponse.json(
      { error: rosterCheck.errors[0] },
      { status: 400 },
    );
  }

  // 3. Calculate signing cost (market value as signing bonus)
  const signingCost = playerValueFromRow(player);

  // 4. Check budget
  const budgetCheck = await checkBudget(supabase, team.id, signingCost);
  if (!budgetCheck.ok) {
    return NextResponse.json(
      { error: `Insufficient funds. Need $${signingCost.toLocaleString()}, have $${budgetCheck.balance.toLocaleString()}` },
      { status: 400 },
    );
  }

  // 5. Assign player to team as reserve
  const { error: updateErr } = await supabase
    .from('players')
    .update({
      team_id: team.id,
      roster_status: 'reserve' as const,
    })
    .eq('id', playerId)
    .eq('roster_status', 'free_agent');

  if (updateErr) {
    return NextResponse.json(
      { error: 'Failed to sign player — may have been signed by another team' },
      { status: 409 },
    );
  }

  // 6. Debit signing bonus (atomic)
  let newBalance: number;
  try {
    newBalance = await safeDebit(
      supabase,
      team.id,
      signingCost,
      'pPurchased',
      `Signed ${player.first_name} ${player.last_name} (signing bonus)`,
      playerId,
    );
  } catch {
    // Reverse the player assignment if debit fails
    await supabase
      .from('players')
      .update({ team_id: null, roster_status: 'free_agent' as const })
      .eq('id', playerId);
    return NextResponse.json(
      { error: 'Insufficient funds' },
      { status: 400 },
    );
  }

  return NextResponse.json({
    success: true,
    player: `${player.first_name} ${player.last_name}`,
    signingCost,
    newBalance,
  });
}
