import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireMyTeam } from '@/lib/queries/team';
import PitchingStaffEditor from '../../../pitching-staff/pitching-staff-editor';

interface PageParams {
  params: Promise<{ id: string }>;
}

export default async function GamePitchersPage({ params }: PageParams) {
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

  // Try loading game-specific rotation from game_rotation
  const { data: grRows } = await supabase
    .from('game_rotation')
    .select('player_id, rotation_slot')
    .eq('schedule_id', scheduleId)
    .eq('team_id', team.id);

  // Load all pitchers
  const { data: allPitchers } = await supabase
    .from('players')
    .select('id, first_name, last_name, jersey_no, roster_status, rotation_slot, age, height, weight, hand_throw, speed, stamina, ag, eye, avg, strength, play_intel, bunting, fielding, throw, country_id')
    .eq('team_id', team.id)
    .eq('fielder', false)
    .order('roster_status')
    .order('rotation_slot')
    .order('last_name');

  // Merge game_rotation data onto pitcher data if available
  let pitchers = allPitchers ?? [];
  if (grRows && grRows.length > 0) {
    const grMap = new Map(grRows.map((r) => [r.player_id, r.rotation_slot]));
    pitchers = pitchers.map((p) => {
      const slot = grMap.get(p.id);
      return slot != null ? { ...p, rotation_slot: slot } : p;
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
        <h1 className="text-2xl font-bold text-white">Game #{scheduleId} — Pitchers</h1>
      </div>
      <PitchingStaffEditor
        pitchers={pitchers}
        nextStarterSlot={typeof team.next_sp_slot === 'number' ? team.next_sp_slot : 1}
        scheduleId={scheduleId}
        gameLabel={gameLabel}
      />
    </div>
  );
}
