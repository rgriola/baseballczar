// Last touched by agent: 2026-05-06T16:42:55Z
// Purpose: Return DB-backed smoke summary stats for league simulation scope.

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/service';
import { buildSimSmokeSummary } from '@/lib/sim/smoke-summary';

const schema = z.object({
  leagueId: z.number().int().positive().optional(),
  seasonNo: z.number().int().positive().optional(),
});

async function readOptionalJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const parsed = schema.safeParse(await readOptionalJson(request));
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.issues[0]?.message ?? 'Invalid request payload' }, { status: 400 });
  }

  try {
    const supabase = createServiceClient();
    const summary = await buildSimSmokeSummary(supabase, {
      leagueId: parsed.data.leagueId,
      seasonNo: parsed.data.seasonNo,
    });

    return NextResponse.json({
      success: true,
      leagueId: parsed.data.leagueId ?? null,
      seasonNo: parsed.data.seasonNo ?? null,
      summary,
    });
  } catch (err) {
    console.error('Failed to build smoke summary:', err);
    return NextResponse.json({ error: 'An internal error occurred' }, { status: 500 });
  }
}
