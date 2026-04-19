import { Ratelimit } from '@upstash/ratelimit';
import { redis } from './client';

/**
 * General API rate limiter — 60 requests per 60 seconds per IP.
 * Uses a sliding-window algorithm so bursts don't lock users out.
 */
export const apiRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(60, '60 s'),
  analytics: true,
  prefix: 'bbczar:api',
});

/**
 * Auth route rate limiter — 10 requests per 60 seconds per IP.
 * Protects login / signup from brute-force.
 */
export const authRateLimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(10, '60 s'),
  analytics: true,
  prefix: 'bbczar:auth',
});
