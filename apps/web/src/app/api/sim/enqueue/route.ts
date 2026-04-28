/**
 * POST /api/sim/enqueue — Enqueue unplayed games onto the BullMQ sim queue.
 * Protected by service-role key.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { simQueue } from '@/lib/queues/sim-queue';

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();

  const { data: games, error } = await supabase
    .from('schedules')
    .select('id, league_id')
    .eq('played', false)
    .order('game_time');

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const jobs = await simQueue.addBulk(
    (games ?? []).map((g) => ({
      name: `sim-${g.id}`,
      data: { scheduleId: g.id, leagueId: g.league_id },
    })),
  );

  return NextResponse.json({ enqueued: jobs.length });
}
