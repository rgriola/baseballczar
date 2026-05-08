// Last touched by agent: 2026-05-07T01:58:51Z
import { createClient } from '@/lib/supabase/server';
import { requireMyTeam } from '@/lib/queries/team';
import LineupEditor from './lineup-editor';

export default async function LineupPage() {
  const team = await requireMyTeam();
  const supabase = await createClient();

  const { data: hitters } = await supabase
    .from('players')
    .select('id, first_name, last_name, jersey_no, position, batt_order, age, height, weight, hand_batting, hand_throw, speed, stamina, ag, eye, avg, strength, play_intel, bunting, fielding, throw, country_id')
    .eq('team_id', team.id)
    .eq('fielder', true)
    .eq('roster_status', 'active')
    .order('batt_order');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">{team.team_name} — Lineup</h1>
      <LineupEditor hitters={hitters ?? []} />
    </div>
  );
}
