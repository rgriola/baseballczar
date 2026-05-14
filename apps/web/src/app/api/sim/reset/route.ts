// Last touched by agent: 2026-05-06T16:04:24Z
/**
 * POST /api/sim/reset — Reset the entire season.
 * Deletes all game results/stats and marks all schedule entries as unplayed.
 * Resets standings to 0-0. Temporary dev/testing endpoint.
 *
 * Optional body: { leagueId?: number }
 * If leagueId is provided, reset is scoped to that league only.
 */

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createServiceClient } from '@/lib/supabase/service';

const requestSchema = z.object({
  leagueId: z.number().int().positive().optional(),
});

const STANDINGS_RESET = {
  w: 0,
  l: 0,
  ab: 0,
  r: 0,
  h: 0,
  b2: 0,
  b3: 0,
  hr: 0,
  rbi: 0,
  bb: 0,
  so: 0,
  sb: 0,
  cs: 0,
  sf: 0,
  sac: 0,
  era_runs: 0,
  era_outs: 0,
  p_ip: 0,
  p_h: 0,
  p_r: 0,
  p_er: 0,
  p_bb: 0,
  p_so: 0,
  p_hr: 0,
};

async function readOptionalJson(request: NextRequest): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

export async function POST(request: NextRequest) {
  const body = await readOptionalJson(request);
  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request payload' },
      { status: 400 },
    );
  }

  const authHeader = request.headers.get('authorization');
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serviceKey || authHeader !== `Bearer ${serviceKey}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const supabase = createServiceClient();

    if (parsed.data.leagueId) {
      const leagueId = parsed.data.leagueId;

      const { data: leagueTeams, error: teamErr } = await supabase
        .from('teams')
        .select('id')
        .eq('league_id', leagueId);

      if (teamErr) {
        console.error('Failed to load league teams for reset:', teamErr.message);
        return NextResponse.json({ error: 'An internal error occurred' }, { status: 500 });
      }

      const teamIds = (leagueTeams ?? []).map((team) => team.id);

      const { error: gamesErr } = await supabase
        .from('games')
        .delete()
        .eq('league_id', leagueId);
      if (gamesErr) {
        console.error('Failed to clear league games:', gamesErr.message);
        return NextResponse.json({ error: 'An internal error occurred' }, { status: 500 });
      }

      if (teamIds.length > 0) {
        const { error: pshErr } = await supabase
          .from('hitter_season_stats')
          .delete()
          .in('team_id', teamIds);
        if (pshErr) {
          console.error('Failed to clear hitter_season_stats:', pshErr.message);
          return NextResponse.json({ error: 'An internal error occurred' }, { status: 500 });
        }

        const { error: pspErr } = await supabase
          .from('pitcher_season_stats')
          .delete()
          .in('team_id', teamIds);
        if (pspErr) {
          console.error('Failed to clear pitcher_season_stats:', pspErr.message);
          return NextResponse.json({ error: 'An internal error occurred' }, { status: 500 });
        }
      }

      const { error: schedErr } = await supabase
        .from('schedules')
        .update({ played: false })
        .eq('league_id', leagueId);

      if (schedErr) {
        console.error('Failed to reset league schedules:', schedErr.message);
        return NextResponse.json({ error: 'An internal error occurred' }, { status: 500 });
      }

      const { error: standErr } = await supabase
        .from('standings')
        .update(STANDINGS_RESET)
        .eq('league_id', leagueId);

      if (standErr) {
        console.error('Failed to reset league standings:', standErr.message);
        return NextResponse.json({ error: 'An internal error occurred' }, { status: 500 });
      }

      const { error: teamsErr } = await supabase
        .from('teams')
        .update({ next_sp_slot: 1 })
        .eq('league_id', leagueId);

      if (teamsErr) {
        console.error('Failed to reset league rotation slots:', teamsErr.message);
        return NextResponse.json({ error: 'An internal error occurred' }, { status: 500 });
      }

      return NextResponse.json({
        success: true,
        message: `League ${leagueId} reset complete`,
        leagueId,
      });
    }

    // 1. Delete game-related data (order matters for FK constraints)
    const deletes = [
      'game_events',
      'hitter_game_stats',
      'pitcher_game_stats',
      'hitter_season_stats',
      'pitcher_season_stats',
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
      .update(STANDINGS_RESET)
      .gte('id', 0);

    if (standErr) {
      return NextResponse.json({ error: `Standings reset failed: ${standErr.message}` }, { status: 500 });
    }

    const { error: teamErr } = await supabase
      .from('teams')
      .update({ next_sp_slot: 1 })
      .gte('id', 0);

    if (teamErr) {
      return NextResponse.json({ error: `Team reset failed: ${teamErr.message}` }, { status: 500 });
    }

    return NextResponse.json({ success: true, message: 'Season reset complete' });
  } catch (err) {
    console.error('Reset failed:', err);
    return NextResponse.json({ error: 'An internal error occurred' }, { status: 500 });
  }
}
