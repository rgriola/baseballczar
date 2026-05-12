// Last touched by agent: 2026-05-06T17:08:21Z
import IORedis from 'ioredis';

/**
 * Shared IORedis connection for BullMQ queues/workers.
 * Uses REDIS_URL (standard connection string) from process env.
 */
export const queueRedisUrl =
  process.env.REDIS_URL ?? process.env.BULLMQ_REDIS_URL ?? process.env.UPSTASH_REDIS_URL ?? 'redis://127.0.0.1:6379';

export const connection = new IORedis(queueRedisUrl, {
  maxRetriesPerRequest: null, // required by BullMQ
  enableReadyCheck: true,
  keepAlive: 30_000,          // send TCP keepalive every 30s to prevent idle drops
  reconnectOnError(err) {
    // auto-reconnect on transient errors (ECONNRESET, READONLY, etc.)
    const target = err.message;
    return target.includes('READONLY') || target.includes('ECONNRESET');
  },
});
