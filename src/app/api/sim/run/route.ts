/**
 * POST /api/sim/run — Trigger simulation of a specific scheduled game.
 *
 * Body: { scheduleId: number }
 *
 * Requires service-role key (called by workers or admin).
 * For user-triggered O2O games, auth is checked separately.
 */

import { NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/service';
import { simulateScheduledGame } from '@/lib/sim/simulate-scheduled-game';

const schema = z.object({
  scheduleId: z.number().int().positive(),
});

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const parsed = schema.safeParse(body);

    if (!parsed.success) {
      return NextResponse.json(
        { error: parsed.error.issues[0].message },
        { status: 400 },
      );
    }

    const supabase = createServiceClient();
    const result = await simulateScheduledGame(supabase, parsed.data.scheduleId);

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Simulation failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
