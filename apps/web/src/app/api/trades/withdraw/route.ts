/**
 * POST /api/trades/withdraw — Withdraw a trade listing
 */

import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { requireMyTeam } from '@/lib/queries/team';
import { z } from 'zod';

const WithdrawSchema = z.object({
  listingId: z.number().int().positive(),
});

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = WithdrawSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0].message }, { status: 400 });
  }

  const supabase = await createClient();
  const team = await requireMyTeam();

  const { error } = await supabase
    .from('trade_listings')
    .update({ status: 'withdrawn' })
    .eq('id', parsed.data.listingId)
    .eq('seller_team_id', team.id)
    .eq('status', 'active');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  // Also reject any pending offers on this listing
  await supabase
    .from('trade_offers')
    .update({ status: 'withdrawn' })
    .eq('listing_id', parsed.data.listingId)
    .eq('status', 'pending');

  return NextResponse.json({ success: true });
}
