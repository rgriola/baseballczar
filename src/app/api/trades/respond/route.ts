/**
 * POST /api/trades/respond — Accept or reject a trade offer
 *
 * On accept: executes trade (player swap + cash transfer).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireMyTeam } from '@/lib/queries/team';
import { executeTrade } from '@/lib/trades/execute';
import { sendNotification } from '@/lib/notifications';
import { z } from 'zod';

const RespondSchema = z.object({
  offerId: z.number().int().positive(),
  action: z.enum(['accept', 'reject']),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = RespondSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const { offerId, action } = parsed.data;
  const supabase = await createClient();
  const team = await requireMyTeam();

  // 1. Load the offer
  const { data: offer } = await supabase
    .from('trade_offers')
    .select('id, listing_id, from_team_id, to_team_id, offered_player_ids, cash_amount, status')
    .eq('id', offerId)
    .eq('status', 'pending')
    .single();

  if (!offer) {
    return NextResponse.json({ error: 'Offer not found or already resolved' }, { status: 404 });
  }

  // Only the receiving team (seller) can respond
  if (offer.to_team_id !== team.id) {
    return NextResponse.json({ error: 'Not authorized to respond to this offer' }, { status: 403 });
  }

  if (action === 'reject') {
    await supabase
      .from('trade_offers')
      .update({ status: 'rejected' })
      .eq('id', offerId);

    // Notify buyer
    const { data: buyerTeam } = await supabase
      .from('teams')
      .select('owner_id')
      .eq('id', offer.from_team_id)
      .single();

    if (buyerTeam?.owner_id) {
      await sendNotification(supabase, buyerTeam.owner_id, 'trade_rejected', {
        message: `${team.team_name} has rejected your trade offer.`,
        offerId,
      });
    }

    return NextResponse.json({ success: true, action: 'rejected' });
  }

  // Accept — execute trade
  try {
    await executeTrade(supabase, offer);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Trade execution failed';
    return NextResponse.json({ error: msg }, { status: 400 });
  }

  // Mark offer as accepted, listing as sold
  await supabase.from('trade_offers').update({ status: 'accepted' }).eq('id', offerId);

  if (offer.listing_id) {
    await supabase.from('trade_listings').update({ status: 'sold' }).eq('id', offer.listing_id);

    // Reject other pending offers on same listing
    await supabase
      .from('trade_offers')
      .update({ status: 'rejected' })
      .eq('listing_id', offer.listing_id)
      .eq('status', 'pending')
      .neq('id', offerId);
  }

  // Notify buyer
  const { data: buyerTeam } = await supabase
    .from('teams')
    .select('owner_id')
    .eq('id', offer.from_team_id)
    .single();

  if (buyerTeam?.owner_id) {
    await sendNotification(supabase, buyerTeam.owner_id, 'trade_accepted', {
      message: `${team.team_name} has accepted your trade offer!`,
      offerId,
    });
  }

  return NextResponse.json({ success: true, action: 'accepted' });
}
