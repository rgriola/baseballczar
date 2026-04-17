import { createClient } from '@/lib/supabase/server';
import { requireMyTeam } from '@/lib/queries/team';
import LineupEditor from './lineup-editor';

export default async function LineupPage() {
  const team = await requireMyTeam();
  const supabase = await createClient();

  const { data: hitters } = await supabase
    .from('players')
    .select('id, first_name, last_name, jersey_no, position, batt_order, speed, ag, eye, avg, strength, dhr')
    .eq('team_id', team.id)
    .eq('fielder', true)
    .eq('roster_status', 'active')
    .order('batt_order');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">{team.team_name} — Batting Lineup</h1>
      <p className="text-sm text-gray-400">
        Drag players to reorder your 9-man batting lineup. Click a bench player to swap them in.
      </p>
      <LineupEditor hitters={hitters ?? []} />
    </div>
  );
}
