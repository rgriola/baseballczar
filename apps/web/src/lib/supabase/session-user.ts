// Last touched by agent: 2026-05-05T17:09:42Z
// Purpose: Share one authenticated user lookup across server components.

import type { User } from '@supabase/supabase-js';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';

export const getSessionUser = cache(async (): Promise<User | null> => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
});