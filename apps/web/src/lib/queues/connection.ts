import IORedis from 'ioredis';

/**
 * Shared IORedis connection for BullMQ queues/workers.
 * Uses REDIS_URL (standard connection string) from env.
 */
const url = process.env.REDIS_URL ?? 'redis://localhost:6379';

export const connection = new IORedis(url, {
  maxRetriesPerRequest: null, // required by BullMQ
});
