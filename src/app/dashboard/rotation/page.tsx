import { createClient } from '@/lib/supabase/server';
import { requireMyTeam } from '@/lib/queries/team';
import RotationEditor from './rotation-editor';

export default async function RotationPage() {
  const team = await requireMyTeam();
  const supabase = await createClient();

  const { data: pitchers } = await supabase
    .from('players')
    .select('id, first_name, last_name, jersey_no, rotation_slot, stamina, ag, eye, avg, strength, dhr, play_intel, hand_throw')
    .eq('team_id', team.id)
    .eq('fielder', false)
    .eq('roster_status', 'active')
    .order('rotation_slot');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">{team.team_name} — Pitching Rotation</h1>
      <p className="text-sm text-gray-400">
        Assign your 5 starting pitchers and up to 4 relievers. Remaining pitchers stay in reserve.
      </p>
      <RotationEditor pitchers={pitchers ?? []} />
    </div>
  );
}
