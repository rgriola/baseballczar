// Last touched by agent: 2026-05-07T22:25:00Z
import fs from 'node:fs';
import { Worker, Job } from 'bullmq';
import type { SimJobData } from '@/lib/queues/sim-queue';
import { createServiceClient } from '@/lib/supabase/service';
import { simulateScheduledGame } from '@/lib/sim/simulate-scheduled-game';
import { logger } from '@/lib/logger';

type QueueConnection = {
  ping: () => Promise<unknown>;
  quit: () => Promise<unknown>;
  disconnect: () => void;
};

let shuttingDown = false;

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

async function shutdownWorker(
  signal: NodeJS.Signals,
  worker: Worker<SimJobData>,
  connection: QueueConnection,
): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ signal }, 'sim-worker shutdown requested');

  const forceExitTimer = setTimeout(() => {
    logger.warn({ signal }, 'sim-worker graceful shutdown timed out; forcing exit');
    connection.disconnect();
    process.exit(0);
  }, 8000);
  forceExitTimer.unref();

  try {
    await worker.close();
    await connection.quit();
    clearTimeout(forceExitTimer);
    logger.info({ signal }, 'sim-worker shutdown complete');
    process.exit(0);
  } catch (err) {
    clearTimeout(forceExitTimer);
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ signal, err: message }, 'sim-worker shutdown failed; forcing exit');
    connection.disconnect();
    process.exit(0);
  }
}

function registerShutdownHandlers(worker: Worker<SimJobData>, connection: QueueConnection): void {
  process.once('SIGINT', () => {
    void shutdownWorker('SIGINT', worker, connection);
  });

  process.once('SIGTERM', () => {
    void shutdownWorker('SIGTERM', worker, connection);
  });
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

  registerShutdownHandlers(worker, connection);

  logger.info('sim-worker listening for jobs');
}

void bootstrapWorker().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err: message }, 'sim-worker failed to start');
  process.exit(1);
});
