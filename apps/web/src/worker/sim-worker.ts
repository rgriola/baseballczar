// Last touched by agent: 2026-05-12T08:30:00Z
import fs from 'node:fs';
import { Worker, Job } from 'bullmq';
import type { SimJobData } from '@/lib/queues/sim-queue';
import { createServiceClient } from '@/lib/supabase/service';
import { simulateScheduledGame } from '@/lib/sim/simulate-scheduled-game';
import { logger } from '@/lib/logger';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type QueueConnection = {
  ping: () => Promise<unknown>;
  quit: () => Promise<unknown>;
  disconnect: () => void;
  status: string;
};

/* ------------------------------------------------------------------ */
/*  Shutdown state                                                     */
/* ------------------------------------------------------------------ */

let shuttingDown = false;
const GRACEFUL_TIMEOUT_MS = 15_000; // max time to wait for in-flight job
const HEARTBEAT_INTERVAL_MS = 5 * 60 * 1_000; // 5 min

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

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

/* ------------------------------------------------------------------ */
/*  Graceful shutdown                                                  */
/* ------------------------------------------------------------------ */

async function shutdownWorker(
  reason: string,
  worker: Worker<SimJobData>,
  connection: QueueConnection,
): Promise<void> {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info({ reason }, 'sim-worker shutdown requested — draining in-flight jobs…');

  // Force-exit safety net in case graceful drain hangs
  const forceExitTimer = setTimeout(() => {
    logger.warn({ reason }, 'sim-worker graceful shutdown timed out after %dms; forcing exit', GRACEFUL_TIMEOUT_MS);
    try { connection.disconnect(); } catch { /* best effort */ }
    process.exit(0);
  }, GRACEFUL_TIMEOUT_MS);
  forceExitTimer.unref();

  try {
    // worker.close() waits for any running job processor to finish,
    // then cleanly de-registers from the queue
    await worker.close();
    logger.info('sim-worker drained — closing Redis connection…');
    await connection.quit();
    clearTimeout(forceExitTimer);
    logger.info({ reason }, 'sim-worker shutdown complete');
    process.exit(0);
  } catch (err) {
    clearTimeout(forceExitTimer);
    const message = err instanceof Error ? err.message : String(err);
    logger.error({ reason, err: message }, 'sim-worker error during shutdown; forcing exit');
    try { connection.disconnect(); } catch { /* best effort */ }
    process.exit(0);
  }
}

/* ------------------------------------------------------------------ */
/*  Signal & crash handlers                                            */
/* ------------------------------------------------------------------ */

function registerShutdownHandlers(worker: Worker<SimJobData>, connection: QueueConnection): void {
  const handle = (signal: string) => {
    void shutdownWorker(signal, worker, connection);
  };

  // Process signals
  process.once('SIGINT', () => handle('SIGINT'));
  process.once('SIGTERM', () => handle('SIGTERM'));
  process.once('SIGHUP', () => handle('SIGHUP'));

  // Catch-all for uncaught errors — log and exit cleanly rather than crashing
  process.once('uncaughtException', (err) => {
    logger.fatal({ err: err.message, stack: err.stack }, 'sim-worker uncaught exception');
    void shutdownWorker('uncaughtException', worker, connection);
  });

  process.once('unhandledRejection', (reason) => {
    const msg = reason instanceof Error ? reason.message : String(reason);
    logger.fatal({ err: msg }, 'sim-worker unhandled rejection');
    void shutdownWorker('unhandledRejection', worker, connection);
  });
}

/* ------------------------------------------------------------------ */
/*  Heartbeat                                                          */
/* ------------------------------------------------------------------ */

function startHeartbeat(connection: QueueConnection): NodeJS.Timeout {
  const timer = setInterval(() => {
    if (shuttingDown) return;
    const redisStatus = connection.status ?? 'unknown';
    logger.info({ redis: redisStatus }, 'sim-worker heartbeat — still listening');
  }, HEARTBEAT_INTERVAL_MS);
  timer.unref(); // don't prevent graceful exit
  return timer;
}

/* ------------------------------------------------------------------ */
/*  Bootstrap                                                          */
/* ------------------------------------------------------------------ */

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
      logger.info({ jobId: job.id, scheduleId }, 'sim job started');
      const supabase = createServiceClient();
      const result = await simulateScheduledGame(supabase, scheduleId);
      return result;
    },
    {
      connection,
      concurrency: 1,
    },
  );

  /* --- Worker event listeners --- */

  worker.on('completed', (job) => {
    logger.info({ jobId: job.id, scheduleId: job.data.scheduleId }, 'sim job completed');
  });

  worker.on('failed', (job, err) => {
    logger.error({ jobId: job?.id, scheduleId: job?.data.scheduleId, err: err.message }, 'sim job failed');
  });

  worker.on('error', (err) => {
    // Non-fatal — BullMQ/IORedis will auto-reconnect; just log it
    if (!shuttingDown) {
      logger.warn({ err: err.message }, 'sim-worker transient error (will auto-reconnect)');
    }
  });

  /* --- Wire everything up --- */

  registerShutdownHandlers(worker, connection);
  startHeartbeat(connection);

  logger.info('sim-worker listening for jobs');
}

void bootstrapWorker().catch((err) => {
  const message = err instanceof Error ? err.message : String(err);
  logger.error({ err: message }, 'sim-worker failed to start');
  process.exit(1);
});
