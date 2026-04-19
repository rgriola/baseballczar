import { createClient } from '@/lib/supabase/server';
import { requireMyTeam } from '@/lib/queries/team';
import { HitterTable, PitcherTable } from './roster-table';

export default async function RosterPage() {
  const team = await requireMyTeam();
  const supabase = await createClient();

  const { data: players } = await supabase
    .from('players')
    .select('*')
    .eq('team_id', team.id)
    .order('fielder', { ascending: false })
    .order('batt_order')
    .order('rotation_slot');

  const hitters = players?.filter((p) => p.fielder) ?? [];
  const pitchers = players?.filter((p) => !p.fielder) ?? [];
  const activeHitters = hitters.filter((p) => p.roster_status === 'active').length;
  const activePitchers = pitchers.filter((p) => p.roster_status === 'active').length;

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-white">{team.team_name} — Roster</h1>

      {/* Hitters */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">
          Position Players ({hitters.length})
        </h2>
        <HitterTable hitters={hitters} activeCount={activeHitters} />
      </section>

      {/* Pitchers */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">
          Pitchers ({pitchers.length})
        </h2>
        <PitcherTable pitchers={pitchers} activeCount={activePitchers} />
      </section>
    </div>
  );
}
