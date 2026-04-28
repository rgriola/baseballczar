/**
 * POST /api/training/assign
 *
 * Batch-update training_slot for multiple players.
 * Validates ownership for each player.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireMyTeam } from '@/lib/queries/team';
import { z } from 'zod';

const AssignSchema = z.object({
  assignments: z.array(
    z.object({
      playerId: z.number().int().positive(),
      slot: z.number().int().min(0).max(9),
    }),
  ),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = AssignSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0].message },
      { status: 400 },
    );
  }

  const { assignments } = parsed.data;
  const supabase = await createClient();
  const team = await requireMyTeam();

  let updated = 0;

  for (const { playerId, slot } of assignments) {
    const { error } = await supabase
      .from('players')
      .update({ training_slot: slot })
      .eq('id', playerId)
      .eq('team_id', team.id);

    if (!error) updated++;
  }

  return NextResponse.json({ updated });
}
