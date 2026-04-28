/**
 * POST /api/training/run
 *
 * Daily training worker — runs training for all eligible players.
 * Protected by service-role key (server-to-server / cron only).
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { runDailyTraining } from '@/lib/training';

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const results = await runDailyTraining(supabase);

  const trained = results.filter((r) => r.improvement > 0).length;
  const skipped = results.filter((r) => r.skipped).length;

  return NextResponse.json({
    total: results.length,
    trained,
    skipped,
    results,
  });
}
