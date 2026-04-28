/**
 * GET /api/cron/daily — run by Vercel Cron every day at 4:00 AM UTC.
 * 1. Simulates all due (past game_time) unplayed games
 * 2. Runs daily training for all players with assigned training slots
 * 3. Expires stale trade offers and challenge requests (>48 h)
 * Protected by CRON_SECRET header.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { simulateScheduledGame } from '@/lib/sim/simulate-scheduled-game';
import { runDailyTraining } from '@/lib/training';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const results: Record<string, unknown> = {};

  // ── 1. Simulate due games ──────────────────────────────────────────
  const now = new Date().toISOString();
  const { data: dueGames, error: gameErr } = await supabase
    .from('schedules')
    .select('id')
    .eq('played', false)
    .lte('game_time', now)
    .order('game_time');

  if (gameErr) {
    logger.error({ error: gameErr.message }, 'cron: failed to fetch due games');
  } else {
    let simulated = 0;
    for (const { id } of dueGames ?? []) {
      try {
        await simulateScheduledGame(supabase, id);
        simulated++;
      } catch (err) {
        logger.error({ scheduleId: id, err }, 'cron: sim failed');
      }
    }
    results.games = { simulated, total: dueGames?.length ?? 0 };
  }

  // ── 2. Run daily training ──────────────────────────────────────────
  try {
    const trainingResults = await runDailyTraining(supabase);
    const trained = trainingResults.filter((r) => r.improvement > 0).length;
    results.training = { total: trainingResults.length, trained };
  } catch (err) {
    logger.error({ err }, 'cron: training failed');
    results.training = { error: err instanceof Error ? err.message : 'unknown' };
  }

  // ── 3. Expire stale trade offers (>48 h pending) ──────────────────
  try {
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data: expiredOfferRows } = await supabase
      .from('trade_offers')
      .update({ status: 'withdrawn' })
      .eq('status', 'pending')
      .lt('created_at', cutoff)
      .select('id');

    const { data: expiredChallengeRows } = await supabase
      .from('challenge_requests')
      .update({ status: 'expired' })
      .eq('status', 'pending')
      .lt('created_at', cutoff)
      .select('id');

    results.expired = {
      tradeOffers: expiredOfferRows?.length ?? 0,
      challenges: expiredChallengeRows?.length ?? 0,
    };
  } catch (err) {
    logger.error({ err }, 'cron: expiry failed');
    results.expired = { error: err instanceof Error ? err.message : 'unknown' };
  }

  logger.info(results, 'cron: daily run complete');
  return NextResponse.json(results);
}
