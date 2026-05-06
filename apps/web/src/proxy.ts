// Last touched by agent: 2026-05-05T17:09:42Z
import { type NextRequest, NextResponse } from 'next/server';
import { classifyProxyPath } from '@/lib/proxy/route-classification';
import { updateSession } from '@/lib/supabase/middleware';
import { apiRateLimit, authRateLimit } from '@/lib/redis/rate-limit';

export async function proxy(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const route = classifyProxyPath(path);

  if (
    route.shouldRateLimit &&
    process.env.UPSTASH_REDIS_REST_URL &&
    process.env.UPSTASH_REDIS_REST_TOKEN
  ) {
    const ip =
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
      '127.0.0.1';

    const limiter = route.isAuthPage ? authRateLimit : apiRateLimit;
    const { success, limit, remaining, reset } = await limiter.limit(ip);

    if (!success) {
      return new NextResponse('Too Many Requests', {
        status: 429,
        headers: {
          'X-RateLimit-Limit': limit.toString(),
          'X-RateLimit-Remaining': remaining.toString(),
          'X-RateLimit-Reset': reset.toString(),
        },
      });
    }
  }

  if (route.shouldRunSessionUpdate) {
    return await updateSession(request);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    '/login',
    '/signup',
    '/reset-password',
    '/auth/:path*',
    '/dashboard/:path*',
    '/api/:path*',
  ],
};
