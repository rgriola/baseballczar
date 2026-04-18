import { createClient } from '@/lib/supabase/server';
import { requireMyTeam } from '@/lib/queries/team';
import { SLOT_MAP } from '@/lib/training';
import TrainingAssigner from './training-assigner';

export default async function TrainingPage() {
  const team = await requireMyTeam();
  const supabase = await createClient();

  const { data: players } = await supabase
    .from('players')
    .select('id, first_name, last_name, position, fielder, age, roster_status, training_slot, speed, stamina, play_intel, avg, strength, eye, bunting, throw, fielding, max_speed, max_stamina, max_play_intel, max_avg, max_strength, max_eye, max_bunting, max_throw, max_fielding, improve_factor')
    .eq('team_id', team.id)
    .in('roster_status', ['active', 'reserve'])
    .order('fielder', { ascending: false })
    .order('position');

  const skillSlots = Object.entries(SLOT_MAP).map(([slot, info]) => ({
    slot: Number(slot),
    ...info,
  }));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-white">
          {team.team_name} — Training
        </h1>
        <p className="mt-1 text-sm text-gray-400">
          Assign each player a skill to train. Players 30+ cannot improve.
          Skills are capped at their max potential.
        </p>
      </div>

      <TrainingAssigner
        players={(players ?? []).map((p) => ({
          id: p.id,
          name: `${p.first_name} ${p.last_name}`,
          position: p.position,
          age: p.age,
          rosterStatus: p.roster_status,
          trainingSlot: p.training_slot,
          lastImprovement: p.improve_factor,
          skills: {
            speed: p.speed,
            stamina: p.stamina,
            play_intel: p.play_intel,
            avg: p.avg,
            strength: p.strength,
            eye: p.eye,
            bunting: p.bunting,
            throw: p.throw,
            fielding: p.fielding,
          },
          maxSkills: {
            speed: p.max_speed,
            stamina: p.max_stamina,
            play_intel: p.max_play_intel,
            avg: p.max_avg,
            strength: p.max_strength,
            eye: p.max_eye,
            bunting: p.max_bunting,
            throw: p.max_throw,
            fielding: p.max_fielding,
          },
        }))}
        skillSlots={skillSlots}
      />
    </div>
  );
}
