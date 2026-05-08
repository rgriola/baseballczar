// Last touched by agent: 2026-05-06T16:42:55Z
// Purpose: Return bulk BullMQ job states for many simulation job IDs.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { simQueue } from '@/lib/queues/sim-queue';

const schema = z.object({
  jobIds: z.array(z.union([z.string(), z.number()])).min(1).max(500),
});

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request payload' }, { status: 400 });
  }

  const statusCounts: Record<string, number> = {
    waiting: 0,
    active: 0,
    delayed: 0,
    completed: 0,
    failed: 0,
    paused: 0,
    'waiting-children': 0,
    notFound: 0,
  };

  const failed: Array<{ jobId: string; reason: string }> = [];
  const states: Array<{ jobId: string; state: string }> = [];

  for (const rawJobId of parsed.data.jobIds) {
    const jobId = String(rawJobId);
    const job = await simQueue.getJob(jobId);
    if (!job) {
      statusCounts.notFound += 1;
      states.push({ jobId, state: 'notFound' });
      continue;
    }

    const state = await job.getState();
    statusCounts[state] = (statusCounts[state] ?? 0) + 1;
    states.push({ jobId, state });

    if (state === 'failed') {
      failed.push({ jobId, reason: job.failedReason ?? 'Unknown error' });
    }
  }

  const pending =
    (statusCounts.waiting ?? 0)
    + (statusCounts.active ?? 0)
    + (statusCounts.delayed ?? 0)
    + (statusCounts.paused ?? 0)
    + (statusCounts['waiting-children'] ?? 0);

  return NextResponse.json({
    success: true,
    total: parsed.data.jobIds.length,
    pending,
    done: pending === 0,
    counts: statusCounts,
    failed,
    states,
  });
}
