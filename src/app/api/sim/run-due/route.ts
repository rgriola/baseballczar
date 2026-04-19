/**
 * POST /api/sim/run-due — Find and simulate all unplayed games that are past due.
 *
 * This replaces the original Java `ExecuteSchedule` timer.
 * Can be called by: BullMQ scheduled job, cron, or admin trigger.
 *
 * Returns: { simulated: number, results: Array<{ scheduleId, gameId, score }> }
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { simulateScheduledGame } from '@/lib/sim/simulate-scheduled-game';

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const supabase = createServiceClient();

    // Find all unplayed games whose game_time is in the past
    const { data: dueGames, error } = await supabase
      .from('schedules')
      .select('id, league_id, home_team_id, visitor_team_id, game_time')
      .eq('played', false)
      .lte('game_time', new Date().toISOString())
      .order('game_time')
      .limit(50); // Process up to 50 per invocation to avoid timeout

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    if (!dueGames || dueGames.length === 0) {
      return NextResponse.json({ simulated: 0, results: [] });
    }

    const results: Array<{
      scheduleId: number;
      gameId: number;
      score: string;
    }> = [];

    for (const game of dueGames) {
      try {
        const result = await simulateScheduledGame(supabase, game.id);
        results.push({
          scheduleId: game.id,
          gameId: result.gameId,
          score: `${result.visitorRuns}-${result.homeRuns}`,
        });
      } catch (err) {
        // Log but continue with remaining games
        console.error(`Failed to sim schedule ${game.id}:`, err);
      }
    }

    return NextResponse.json({
      simulated: results.length,
      results,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Batch sim failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
