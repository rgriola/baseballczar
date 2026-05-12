import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireMyTeam } from '@/lib/queries/team';
import LineupEditor from '../../../lineup/lineup-editor';

interface PageParams {
  params: Promise<{ id: string }>;
}

export default async function GameLineupPage({ params }: PageParams) {
  const { id } = await params;
  const scheduleId = Number(id);
  if (!Number.isFinite(scheduleId) || scheduleId < 1) {
    return <div className="text-red-400">Invalid game ID</div>;
  }

  const team = await requireMyTeam();
  const supabase = await createClient();

  // Load schedule entry
  const { data: sched } = await supabase
    .from('schedules')
    .select('id, home_team_id, visitor_team_id, game_time, played')
    .eq('id', scheduleId)
    .single();

  if (!sched) {
    return <div className="text-red-400">Game #{scheduleId} not found</div>;
  }
  if (sched.home_team_id !== team.id && sched.visitor_team_id !== team.id) {
    return <div className="text-red-400">This game does not involve your team.</div>;
  }
  if (sched.played) {
    return <div className="text-red-400">Game #{scheduleId} has already been played.</div>;
  }

  // Load team names for the label
  const { data: teams } = await supabase
    .from('teams')
    .select('id, team_name')
    .in('id', [sched.home_team_id, sched.visitor_team_id]);
  const nameMap = new Map((teams ?? []).map((t) => [t.id, t.team_name]));
  const homeName = nameMap.get(sched.home_team_id) ?? 'Home';
  const awayName = nameMap.get(sched.visitor_team_id) ?? 'Away';
  const gameDate = new Date(sched.game_time).toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });

  // Try loading game-specific lineup from game_lineups
  const { data: glRows } = await supabase
    .from('game_lineups')
    .select('player_id, batt_order, position')
    .eq('schedule_id', scheduleId)
    .eq('team_id', team.id);

  // Load all active hitters for this team
  const { data: allHitters } = await supabase
    .from('players')
    .select('id, first_name, last_name, jersey_no, position, batt_order, age, height, weight, hand_batting, hand_throw, speed, stamina, ag, eye, avg, strength, play_intel, bunting, fielding, throw, country_id')
    .eq('team_id', team.id)
    .eq('fielder', true)
    .eq('roster_status', 'active')
    .order('batt_order');

  // Merge game_lineups data onto player data if available
  let hitters = allHitters ?? [];
  if (glRows && glRows.length > 0) {
    const glMap = new Map(glRows.map((r) => [r.player_id, r]));
    hitters = hitters.map((h) => {
      const gl = glMap.get(h.id);
      return gl ? { ...h, batt_order: gl.batt_order, position: gl.position } : h;
    });
  }

  const gameLabel = `Game #${scheduleId} — ${awayName} @ ${homeName} (${gameDate})`;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link
          href="/dashboard/schedule"
          className="rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
        >
          ← Schedule
        </Link>
        <h1 className="text-2xl font-bold text-white">Game #{scheduleId} — Lineup</h1>
      </div>
      <LineupEditor hitters={hitters} scheduleId={scheduleId} gameLabel={gameLabel} />
    </div>
  );
}
