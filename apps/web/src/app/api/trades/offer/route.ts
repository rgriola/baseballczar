/**
 * POST /api/trades/offer — Submit a trade offer on a listing
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireMyTeam } from '@/lib/queries/team';
import { checkBudget } from '@/lib/finance';
import { sendNotification } from '@/lib/notifications';
import { z } from 'zod';

const OfferSchema = z.object({
  listingId: z.number().int().positive(),
  offeredPlayerIds: z.array(z.number().int().positive()).default([]),
  cashAmount: z.number().int().min(0).default(0),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = OfferSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { listingId, offeredPlayerIds, cashAmount } = parsed.data;
  const supabase = await createClient();
  const team = await requireMyTeam();

  // 1. Verify listing exists and is active
  const { data: listing } = await supabase
    .from('trade_listings')
    .select('id, seller_team_id, player_id, status')
    .eq('id', listingId)
    .eq('status', 'active')
    .single();

  if (!listing) {
    return NextResponse.json({ error: 'Listing not found or no longer active' }, { status: 404 });
  }

  // Can't offer on your own listing
  if (listing.seller_team_id === team.id) {
    return NextResponse.json({ error: 'Cannot bid on your own listing' }, { status: 400 });
  }

  // 2. Verify offered players belong to our team
  if (offeredPlayerIds.length > 0) {
    const { data: ourPlayers } = await supabase
      .from('players')
      .select('id')
      .eq('team_id', team.id)
      .in('id', offeredPlayerIds);

    if ((ourPlayers?.length ?? 0) !== offeredPlayerIds.length) {
      return NextResponse.json({ error: 'Some offered players are not on your team' }, { status: 400 });
    }
  }

  // 3. Check budget for cash portion
  if (cashAmount > 0) {
    const budgetCheck = await checkBudget(supabase, team.id, cashAmount);
    if (!budgetCheck.ok) {
      return NextResponse.json({ error: `Insufficient funds for cash offer` }, { status: 400 });
    }
  }

  // 4. Insert offer
  const { data: offer, error } = await supabase
    .from('trade_offers')
    .insert({
      listing_id: listingId,
      from_team_id: team.id,
      to_team_id: listing.seller_team_id,
      offered_player_ids: offeredPlayerIds.length > 0 ? offeredPlayerIds : null,
      cash_amount: cashAmount,
    })
    .select('id')
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // 5. Notify seller
  const { data: sellerTeam } = await supabase
    .from('teams')
    .select('owner_id, team_name')
    .eq('id', listing.seller_team_id)
    .single();

  if (sellerTeam?.owner_id) {
    await sendNotification(supabase, sellerTeam.owner_id, 'trade_offer', {
      message: `${team.team_name} has made a trade offer on your listing.`,
      offerId: offer?.id,
      listingId,
    });
  }

  return NextResponse.json({ success: true, offerId: offer?.id });
}
