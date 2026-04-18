/**
 * POST /api/market/release
 *
 * Release a player from the authenticated user's team to free agency.
 * Validates: ownership, roster minimums after release.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireMyTeam } from '@/lib/queries/team';
import { countRoster, canDeactivate, ROSTER_LIMITS } from '@/lib/provisioning';
import { z } from 'zod';

const ReleaseSchema = z.object({
  playerId: z.number().int().positive(),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = ReleaseSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 },
    );
  }

  const { playerId } = parsed.data;
  const supabase = await createClient();
  const team = await requireMyTeam();

  // 1. Verify player belongs to this team
  const { data: player } = await supabase
    .from('players')
    .select('id, first_name, last_name, roster_status, team_id, fielder')
    .eq('id', playerId)
    .eq('team_id', team.id)
    .single();

  if (!player) {
    return NextResponse.json({ error: 'Player not found on your team' }, { status: 404 });
  }

  // 2. If player is active, check roster minimums after removal
  if (player.roster_status === 'active') {
    const { data: roster } = await supabase
      .from('players')
      .select('fielder, roster_status')
      .eq('team_id', team.id)
      .in('roster_status', ['active', 'reserve']);

    const counts = countRoster(roster ?? []);

    // Check that removing this active player won't break minimums
    const check = canDeactivate(counts, player.fielder);
    if (!check.valid) {
      return NextResponse.json(
        { error: check.errors[0] },
        { status: 400 },
      );
    }

    // Also check we stay above min active total after full removal
    const totalActiveAfter = counts.activePitchers + counts.activeFielders - 1;
    if (totalActiveAfter < ROSTER_LIMITS.MIN_ACTIVE) {
      return NextResponse.json(
        { error: `Cannot release — active roster would drop to ${totalActiveAfter}, minimum is ${ROSTER_LIMITS.MIN_ACTIVE}` },
        { status: 400 },
      );
    }
  }

  // 3. Release to free agency
  const { error: updateErr } = await supabase
    .from('players')
    .update({
      team_id: null,
      roster_status: 'free_agent' as const,
      batt_order: 0,
      rotation_slot: 0,
      training_slot: 0,
    })
    .eq('id', playerId)
    .eq('team_id', team.id);

  if (updateErr) {
    return NextResponse.json(
      { error: 'Failed to release player' },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    player: `${player.first_name} ${player.last_name}`,
  });
}
