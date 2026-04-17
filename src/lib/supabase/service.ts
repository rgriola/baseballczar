import { createClient } from '@supabase/supabase-js';

/**
 * Admin client using the service_role key.
 * Use ONLY in server-side code (API routes, workers).
 * Never expose to the browser.
 */
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}
