/**
 * POST /api/sim/sim-all — Simulate ALL remaining unplayed games in the season.
 * No date filter — just runs every unplayed schedule entry.
 * Temporary dev/testing endpoint.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { simulateScheduledGame } from '@/lib/sim/simulate-scheduled-game';

export const maxDuration = 300; // Allow up to 5 minutes

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const supabase = createServiceClient();

    const { data: allGames, error } = await supabase
      .from('schedules')
      .select('id')
      .eq('played', false)
      .order('game_time');

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!allGames || allGames.length === 0) {
      return NextResponse.json({ simulated: 0, message: 'No games to simulate' });
    }

    let simulated = 0;
    let failed = 0;
    const maxRetries = 2;

    for (const game of allGames) {
      let success = false;
      for (let attempt = 0; attempt <= maxRetries && !success; attempt++) {
        try {
          if (attempt > 0) {
            // Wait longer on retry
            await new Promise((r) => setTimeout(r, 500 * attempt));
          }
          await simulateScheduledGame(supabase, game.id);
          simulated++;
          success = true;
        } catch (err) {
          if (attempt === maxRetries) {
            console.error(`Failed to sim schedule ${game.id} after ${maxRetries + 1} attempts:`, err);
            failed++;
          }
        }
      }
      // Small delay between games to avoid overwhelming Supabase
      if (simulated % 5 === 0) {
        await new Promise((r) => setTimeout(r, 200));
      }
    }

    return NextResponse.json({
      simulated,
      failed,
      total: allGames.length,
      message: `Simulated ${simulated} of ${allGames.length} games`,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Sim-all failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
