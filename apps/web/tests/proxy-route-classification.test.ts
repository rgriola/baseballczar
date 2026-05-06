// Last touched by agent: 2026-05-05T17:09:42Z
// Purpose: Regression tests for proxy route classification decisions.

import { describe, expect, it } from 'vitest';
import { classifyProxyPath } from '../src/lib/proxy/route-classification';

describe('classifyProxyPath', () => {
  it('classifies auth pages for rate limiting and session updates', () => {
    const route = classifyProxyPath('/login');

    expect(route.isAuthPage).toBe(true);
    expect(route.shouldRateLimit).toBe(true);
    expect(route.shouldRunSessionUpdate).toBe(true);
  });

  it('classifies dashboard routes for session updates only', () => {
    const route = classifyProxyPath('/dashboard/market');

    expect(route.isDashboardRoute).toBe(true);
    expect(route.shouldRunSessionUpdate).toBe(true);
    expect(route.shouldRateLimit).toBe(false);
  });

  it('classifies api routes for rate limiting only', () => {
    const route = classifyProxyPath('/api/trades/offer');

    expect(route.isApiRoute).toBe(true);
    expect(route.shouldRateLimit).toBe(true);
    expect(route.shouldRunSessionUpdate).toBe(false);
  });

  it('skips unrelated public routes', () => {
    const route = classifyProxyPath('/sim-lab-2');

    expect(route.shouldRateLimit).toBe(false);
    expect(route.shouldRunSessionUpdate).toBe(false);
  });
});