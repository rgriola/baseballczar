// Last touched by agent: 2026-05-06T13:37:53Z
import { createClient } from '@/lib/supabase/server';
import { requireMyTeam } from '@/lib/queries/team';
import RotationEditor from './rotation-editor';

export default async function RotationPage() {
  const team = await requireMyTeam();
  const supabase = await createClient();

  const { data: pitchers } = await supabase
    .from('players')
    .select('id, first_name, last_name, jersey_no, rotation_slot, age, height, weight, hand_throw, speed, stamina, ag, eye, avg, strength, play_intel, bunting, fielding, throw, country_id')
    .eq('team_id', team.id)
    .eq('fielder', false)
    .eq('roster_status', 'active')
    .order('rotation_slot');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">{team.team_name} — Pitching Rotation</h1>
      <p className="text-sm text-gray-400">
        Assign 10-12 pitchers: 5 starters (SP1-SP5), 4-6 relievers (RP1-RP6), and 1 closer (CL). Starters rotate each game automatically.
      </p>
      <RotationEditor pitchers={pitchers ?? []} />
    </div>
  );
}
