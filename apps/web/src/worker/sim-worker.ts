import { Worker, Job } from 'bullmq';
import { connection } from '@/lib/queues/connection';
import type { SimJobData } from '@/lib/queues/sim-queue';
import { createServiceClient } from '@/lib/supabase/service';
import { simulateScheduledGame } from '@/lib/sim/simulate-scheduled-game';
import { logger } from '@/lib/logger';

/**
 * Sim-game worker — processes queued game simulations one at a time.
 *
 * Start this in a separate process:
 *   npx tsx src/worker/sim-worker.ts
 */
const worker = new Worker<SimJobData>(
  'sim-game',
  async (job: Job<SimJobData>) => {
    const { scheduleId } = job.data;
    const supabase = createServiceClient();
    const result = await simulateScheduledGame(supabase, scheduleId);
    return result;
  },
  {
    connection,
    concurrency: 1,
  },
);

worker.on('completed', (job) => {
  logger.info({ jobId: job.id, scheduleId: job.data.scheduleId }, 'sim job completed');
});

worker.on('failed', (job, err) => {
  logger.error({ jobId: job?.id, scheduleId: job?.data.scheduleId, err: err.message }, 'sim job failed');
});

logger.info('sim-worker listening for jobs');
