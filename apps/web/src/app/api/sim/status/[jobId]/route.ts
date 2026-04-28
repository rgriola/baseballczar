/**
 * GET /api/sim/status/[jobId] — Check the status of a queued sim job.
 * Protected by service-role key.
 */
import { NextRequest, NextResponse } from 'next/server';
import { simQueue } from '@/lib/queues/sim-queue';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ jobId: string }> },
) {
  const { jobId } = await params;
  const authHeader = request.headers.get('authorization');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const job = await simQueue.getJob(jobId);
  if (!job) {
    return NextResponse.json({ error: 'Job not found' }, { status: 404 });
  }

  const state = await job.getState();
  const progress = job.progress;

  return NextResponse.json({
    jobId: job.id,
    state,
    progress,
    data: job.data,
    ...(state === 'completed' && { result: job.returnvalue }),
    ...(state === 'failed' && { error: job.failedReason }),
  });
}
