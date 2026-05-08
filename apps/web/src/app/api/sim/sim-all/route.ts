// Last touched by agent: 2026-05-06T17:08:47Z
/**
 * POST /api/sim/sim-all — Simulate remaining unplayed schedule entries.
 *
 * Optional body:
 *   {
 *     mode?: 'inline' | 'queue',
 *     leagueId?: number,
 *     seasonNo?: number,
 *     maxGames?: number,
 *     includeSummary?: boolean,
 *   }
 *
 * mode=inline  -> execute simulations in this request (default)
 * mode=queue   -> enqueue simulations to BullMQ and return immediately
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/service';
import { simulateScheduledGame } from '@/lib/sim/simulate-scheduled-game';
import { buildSimSmokeSummary } from '@/lib/sim/smoke-summary';
import { simQueue } from '@/lib/queues/sim-queue';

export const maxDuration = 300; // Allow up to 5 minutes

const modeSchema = z.enum(['inline', 'queue']);

const requestSchema = z.object({
  mode: modeSchema.optional(),
  leagueId: z.number().int().positive().optional(),
  seasonNo: z.number().int().positive().optional(),
  maxGames: z.number().int().positive().max(500).optional(),
  includeSummary: z.boolean().optional(),
});

interface ScheduleInlineRow {
  id: number;
}

interface ScheduleQueueRow extends ScheduleInlineRow {
  league_id: number;
}

async function readOptionalJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export async function POST(request: NextRequest) {
  const body = await readOptionalJson(request);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request payload' },
      { status: 400 },
    );
  }

  const authHeader = request.headers.get('authorization');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const supabase = createServiceClient();
    const mode = parsed.data.mode ?? 'inline';
    const batchSize = parsed.data.maxGames ?? 25;
    const includeSummary = parsed.data.includeSummary !== false;
    const summaryScope = {
      leagueId: parsed.data.leagueId,
      seasonNo: parsed.data.seasonNo,
    };

    const buildSummarySafely = async () => {
      if (!includeSummary) return null;
      try {
        return await buildSimSmokeSummary(supabase, summaryScope);
      } catch (summaryErr) {
        console.error('Failed to build sim-all summary:', summaryErr);
        return null;
      }
    };

    let remainingCountQuery = supabase
      .from('schedules')
      .select('id', { count: 'exact', head: true })
      .eq('played', false);

    if (parsed.data.leagueId) {
      remainingCountQuery = remainingCountQuery.eq('league_id', parsed.data.leagueId);
    }

    if (parsed.data.seasonNo) {
      remainingCountQuery = remainingCountQuery.eq('season_no', parsed.data.seasonNo);
    }

    const { count: remainingBefore, error: remainingBeforeErr } = await remainingCountQuery;
    if (remainingBeforeErr) {
      console.error('Failed to count schedules for sim-all:', remainingBeforeErr.message);
      return NextResponse.json({ error: 'An internal error occurred' }, { status: 500 });
    }

    const scheduleSelect = mode === 'queue' ? 'id, league_id' : 'id';

    let query = supabase
      .from('schedules')
      .select(scheduleSelect)
      .eq('played', false)
      .order('game_time')
      .limit(batchSize);

    if (parsed.data.leagueId) {
      query = query.eq('league_id', parsed.data.leagueId);
    }

    if (parsed.data.seasonNo) {
      query = query.eq('season_no', parsed.data.seasonNo);
    }

    const { data: allGames, error } = await query;

    if (error) {
      console.error('Failed to load schedules for sim-all:', error.message);
      return NextResponse.json({ error: 'An internal error occurred' }, { status: 500 });
    }

    if (!allGames || allGames.length === 0) {
      return NextResponse.json({
        success: true,
        mode,
        simulated: 0,
        enqueued: 0,
        failed: 0,
        total: 0,
        maxGames: batchSize,
        remainingBefore: remainingBefore ?? 0,
        remainingAfter: remainingBefore ?? 0,
        hasMore: false,
        leagueId: parsed.data.leagueId ?? null,
        seasonNo: parsed.data.seasonNo ?? null,
        message: 'No games to simulate',
        summary: await buildSummarySafely(),
      });
    }

    if (mode === 'queue') {
      const queueRows = allGames as unknown as ScheduleQueueRow[];
      const queueJobs = await simQueue.addBulk(
        queueRows.map((game) => ({
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
      const remainingAfterEstimate = Math.max(0, (remainingBefore ?? queueRows.length) - queueRows.length);

      return NextResponse.json({
        success: true,
        mode,
        simulated: 0,
        enqueued: queueJobs.length,
        failed: 0,
        total: queueRows.length,
        maxGames: batchSize,
        remainingBefore: remainingBefore ?? queueRows.length,
        remainingAfter: remainingAfterEstimate,
        hasMore: remainingAfterEstimate > 0,
        leagueId: parsed.data.leagueId ?? null,
        seasonNo: parsed.data.seasonNo ?? null,
        queueJobIds: queueJobs.map((job) => String(job.id)),
        queueCounts,
        message: `Enqueued ${queueJobs.length} games for worker processing`,
        summary: await buildSummarySafely(),
      });
    }

    const inlineRows = allGames as unknown as ScheduleInlineRow[];

    let simulated = 0;
    let failed = 0;
    const maxRetries = 2;

    for (const game of inlineRows) {
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

    let remainingAfterQuery = supabase
      .from('schedules')
      .select('id', { count: 'exact', head: true })
      .eq('played', false);

    if (parsed.data.leagueId) {
      remainingAfterQuery = remainingAfterQuery.eq('league_id', parsed.data.leagueId);
    }

    if (parsed.data.seasonNo) {
      remainingAfterQuery = remainingAfterQuery.eq('season_no', parsed.data.seasonNo);
    }

    const { count: remainingAfter, error: remainingAfterErr } = await remainingAfterQuery;
    if (remainingAfterErr) {
      console.error('Failed to count remaining schedules for sim-all:', remainingAfterErr.message);
      return NextResponse.json({ error: 'An internal error occurred' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      mode,
      simulated,
      enqueued: 0,
      failed,
      total: inlineRows.length,
      maxGames: batchSize,
      remainingBefore: remainingBefore ?? inlineRows.length,
      remainingAfter: remainingAfter ?? 0,
      hasMore: (remainingAfter ?? 0) > 0,
      leagueId: parsed.data.leagueId ?? null,
      seasonNo: parsed.data.seasonNo ?? null,
      message: `Simulated ${simulated} of ${allGames.length} games in this batch`,
      summary: await buildSummarySafely(),
    });
  } catch (err) {
    console.error('Sim-all failed:', err);
    return NextResponse.json({ error: 'An internal error occurred' }, { status: 500 });
  }
}
