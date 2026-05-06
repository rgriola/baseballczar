// Last touched by agent: 2026-05-05T17:09:42Z
// Purpose: Classify proxy route behavior for session refresh and rate limiting.

export type ProxyRouteClassification = {
  isAuthPage: boolean;
  isAuthCallbackRoute: boolean;
  isDashboardRoute: boolean;
  isApiRoute: boolean;
  shouldRunSessionUpdate: boolean;
  shouldRateLimit: boolean;
};

const AUTH_PAGES = new Set(['/login', '/signup', '/reset-password']);

export function classifyProxyPath(pathname: string): ProxyRouteClassification {
  const isAuthPage = AUTH_PAGES.has(pathname);
  const isAuthCallbackRoute = pathname === '/auth' || pathname.startsWith('/auth/');
  const isDashboardRoute = pathname === '/dashboard' || pathname.startsWith('/dashboard/');
  const isApiRoute = pathname === '/api' || pathname.startsWith('/api/');

  return {
    isAuthPage,
    isAuthCallbackRoute,
    isDashboardRoute,
    isApiRoute,
    shouldRunSessionUpdate: isAuthPage || isAuthCallbackRoute || isDashboardRoute,
    shouldRateLimit: isAuthPage || isApiRoute,
  };
}