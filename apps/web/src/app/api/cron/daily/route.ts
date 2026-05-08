// Last touched by agent: 2026-05-06T17:08:47Z
/**
 * GET /api/cron/daily — run by Vercel Cron every day at 4:00 AM UTC.
 * 1. Enqueues due (past game_time) unplayed games for BullMQ workers
 * 2. Runs daily training for all players with assigned training slots
 * 3. Expires stale trade offers and challenge requests (>48 h)
 * Protected by CRON_SECRET header.
 */
import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';
import { simQueue } from '@/lib/queues/sim-queue';
import { runDailyTraining } from '@/lib/training';
import { logger } from '@/lib/logger';

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const supabase = createServiceClient();
  const results: Record<string, unknown> = {};

  // ── 1. Enqueue due games ───────────────────────────────────────────
  const now = new Date().toISOString();
  const { data: dueGames, error: gameErr } = await supabase
    .from('schedules')
    .select('id, league_id')
    .eq('played', false)
    .lte('game_time', now)
    .order('game_time');

  if (gameErr) {
    logger.error({ error: gameErr.message }, 'cron: failed to fetch due games');
  } else {
    const jobs = await simQueue.addBulk(
      (dueGames ?? []).map((game) => ({
        name: 'sim-scheduled-game',
        data: {
          scheduleId: game.id,
          leagueId: game.league_id,
        },
        opts: {
          jobId: `schedule-${game.id}`,
          attempts: 3,
          backoff: {
            type: 'exponential',
            delay: 1000,
          },
        },
      })),
    );

    const queueCounts = await simQueue.getJobCounts('waiting', 'active', 'delayed', 'completed', 'failed');
    results.games = {
      due: dueGames?.length ?? 0,
      enqueued: jobs.length,
      queueCounts,
    };

    if ((dueGames?.length ?? 0) > 0 && jobs.length === 0) {
      logger.warn({ due: dueGames?.length ?? 0 }, 'cron: due games found but no jobs were enqueued');
    }
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
