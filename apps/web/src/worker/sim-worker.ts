// Last touched by agent: 2026-05-06T17:08:21Z
import fs from 'node:fs';
import { Worker, Job } from 'bullmq';
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

function redactRedisUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.username) parsed.username = '***';
    if (parsed.password) parsed.password = '***';
    return parsed.toString();
  } catch {
    return url;
  }
}

function printRedisHelp(errorText: string, redisUrl: string): void {
  console.error(`\n[sim-worker] Redis connectivity check failed: ${errorText}`);
  console.error(`[sim-worker] Using Redis URL: ${redactRedisUrl(redisUrl)}`);
  console.error('[sim-worker] Fix options:');
  console.error('  1) Set REDIS_URL (or BULLMQ_REDIS_URL) in your shell env, .env.local, or apps/web/.env.local');
  console.error('  2) Start local Redis for dev: docker run --name bbczar-redis -p 6379:6379 -d redis:7');
  console.error('  3) Keep npm run sim:worker running in a separate terminal while queue mode is active\n');
}

function stripQuotes(value: string): string {
  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }
  return value;
}

function hydrateWorkerEnvFromFile(filePath: string): void {
  if (!fs.existsSync(filePath)) return;
  const text = fs.readFileSync(filePath, 'utf8');
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (process.env[key] !== undefined) continue;
    process.env[key] = stripQuotes(line.slice(eq + 1).trim());
  }
}

function ensureRedisEnvLoaded(): void {
  const hasRedisEnv = process.env.REDIS_URL || process.env.BULLMQ_REDIS_URL || process.env.UPSTASH_REDIS_URL;
  if (hasRedisEnv) return;

  hydrateWorkerEnvFromFile('.env.local');
  hydrateWorkerEnvFromFile('.env');
  hydrateWorkerEnvFromFile('apps/web/.env.local');
  hydrateWorkerEnvFromFile('apps/web/.env');
}

async function bootstrapWorker(): Promise<void> {
  ensureRedisEnvLoaded();

  const { connection, queueRedisUrl } = await import('@/lib/queues/connection');

  try {
    await connection.ping();
    logger.info({ redisUrl: redactRedisUrl(queueRedisUrl) }, 'sim-worker connected to Redis');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    printRedisHelp(message, queueRedisUrl);
    process.exit(1);
  }

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

  worker.on('error', (err) => {
    logger.error({ err: err.message }, 'sim-worker runtime error');
  });

  logger.info('sim-worker listening for jobs');
}

void bootstrapWorker();
