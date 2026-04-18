/**
 * POST /api/sim/reset — Reset the entire season.
 * Deletes all game results/stats and marks all schedule entries as unplayed.
 * Resets standings to 0-0. Temporary dev/testing endpoint.
 */

import { NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase/service';

export async function POST() {
  try {
    const supabase = createServiceClient();

    // 1. Delete game-related data (order matters for FK constraints)
    const deletes = [
      'game_events',
      'game_stats_hitting',
      'game_stats_pitching',
      'player_stats_hitting',
      'player_stats_pitching',
      'games',
    ];

    for (const table of deletes) {
      const { error } = await supabase.from(table).delete().gte('id', 0);
      if (error) {
        console.error(`Failed to clear ${table}:`, error.message);
      }
    }

    // 2. Mark all schedule entries as unplayed
    const { error: schedErr } = await supabase
      .from('schedules')
      .update({ played: false })
      .gte('id', 0);

    if (schedErr) {
      return NextResponse.json({ error: `Schedule reset failed: ${schedErr.message}` }, { status: 500 });
    }

    // 3. Reset standings to 0-0
    const { error: standErr } = await supabase
      .from('standings')
      .update({
        w: 0, l: 0,
        ab: 0, r: 0, h: 0, b2: 0, b3: 0, hr: 0,
        rbi: 0, bb: 0, so: 0, sb: 0, cs: 0, sf: 0, sac: 0,
      })
      .gte('id', 0);

    if (standErr) {
      return NextResponse.json({ error: `Standings reset failed: ${standErr.message}` }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Season reset complete' });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Reset failed';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
