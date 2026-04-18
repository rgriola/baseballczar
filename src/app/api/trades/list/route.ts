/**
 * POST /api/trades/list   — List a player on the trade block
 * POST /api/trades/withdraw — Withdraw a listing
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireMyTeam } from '@/lib/queries/team';
import { playerValueFromRow } from '@/lib/finance';
import { z } from 'zod';

const ListSchema = z.object({
  playerId: z.number().int().positive(),
  askingPrice: z.number().int().min(0).optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = ListSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { playerId, askingPrice } = parsed.data;
  const supabase = await createClient();
  const team = await requireMyTeam();

  // Verify player belongs to team
  const { data: player } = await supabase
    .from('players')
    .select('id, first_name, last_name, team_id, speed, stamina, play_intel, avg, strength, eye, bunting, throw, fielding')
    .eq('id', playerId)
    .eq('team_id', team.id)
    .single();

  if (!player) {
    return NextResponse.json({ error: 'Player not found on your team' }, { status: 404 });
  }

  // Check not already listed
  const { data: existing } = await supabase
    .from('trade_listings')
    .select('id')
    .eq('player_id', playerId)
    .eq('status', 'active')
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ error: 'Player is already listed' }, { status: 400 });
  }

  const value = askingPrice ?? playerValueFromRow(player);

  const { data: listing, error } = await supabase
    .from('trade_listings')
    .insert({
      seller_team_id: team.id,
      player_id: playerId,
      asking_price: value,
    })
    .select('id')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ success: true, listingId: listing?.id, askingPrice: value });
}
