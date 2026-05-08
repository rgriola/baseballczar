// Last touched by agent: 2026-05-06T21:11:06Z
// Purpose: Loads pitcher data for the Pitching Staff drag-and-drop dashboard page.
import { createClient } from '@/lib/supabase/server';
import { requireMyTeam } from '@/lib/queries/team';
import PitchingStaffEditor from './pitching-staff-editor';

export default async function PitchingStaffPage() {
  const team = await requireMyTeam();
  const supabase = await createClient();

  const { data: pitchers } = await supabase
    .from('players')
    .select('id, first_name, last_name, jersey_no, roster_status, rotation_slot, age, height, weight, hand_throw, speed, stamina, ag, eye, avg, strength, play_intel, bunting, fielding, throw, country_id')
    .eq('team_id', team.id)
    .eq('fielder', false)
    .order('roster_status')
    .order('rotation_slot')
    .order('last_name');

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">{team.team_name} - Pitching Staff</h1>
      <PitchingStaffEditor
        pitchers={pitchers ?? []}
        nextStarterSlot={typeof team.next_sp_slot === 'number' ? team.next_sp_slot : 1}
      />
    </div>
  );
}
