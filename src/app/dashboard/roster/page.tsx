import { createClient } from '@/lib/supabase/server';
import { requireMyTeam } from '@/lib/queries/team';
import RosterToggle from './roster-toggle';

const HAND_LABEL: Record<number, string> = { 1: 'R', 2: 'L', 3: 'S' };

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

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-white">{team.team_name} — Roster</h1>

      {/* Hitters */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">
          Position Players ({hitters.length})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-gray-400">
                <th className="pb-2">#</th>
                <th className="pb-2">Name</th>
                <th className="pb-2">Pos</th>
                <th className="pb-2">Status</th>
                <th className="pb-2"></th>
                <th className="pb-2 text-right">Age</th>
                <th className="pb-2 text-right">B/T</th>
                <th className="pb-2 text-right">SPD</th>
                <th className="pb-2 text-right">AG</th>
                <th className="pb-2 text-right">EYE</th>
                <th className="pb-2 text-right">AVG</th>
                <th className="pb-2 text-right">STR</th>
                <th className="pb-2 text-right">DHR</th>
                <th className="pb-2 text-right">FLD</th>
                <th className="pb-2 text-right">Salary</th>
              </tr>
            </thead>
            <tbody>
              {hitters.map((p) => (
                <tr key={p.id} className={`border-b border-gray-800/50 ${p.roster_status === 'active' ? 'text-gray-300' : 'text-gray-500'}`}>
                  <td className="py-1.5">{p.jersey_no}</td>
                  <td className="py-1.5 font-medium">{p.first_name} {p.last_name}</td>
                  <td className="py-1.5">{p.position}</td>
                  <td className="py-1.5">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${p.roster_status === 'active' ? 'bg-green-900/50 text-green-400' : 'bg-gray-800 text-gray-500'}`}>
                      {p.roster_status}
                    </span>
                  </td>
                  <td className="py-1.5">
                    {(p.roster_status === 'active' || p.roster_status === 'reserve') && (
                      <RosterToggle playerId={p.id} currentStatus={p.roster_status} />
                    )}
                  </td>
                  <td className="py-1.5 text-right">{p.age}</td>
                  <td className="py-1.5 text-right">{HAND_LABEL[p.hand_batting]}/{HAND_LABEL[p.hand_throw]}</td>
                  <td className="py-1.5 text-right">{p.speed}</td>
                  <td className="py-1.5 text-right">{p.ag}</td>
                  <td className="py-1.5 text-right">{p.eye}</td>
                  <td className="py-1.5 text-right">{p.avg}</td>
                  <td className="py-1.5 text-right">{p.strength}</td>
                  <td className="py-1.5 text-right">{p.dhr}</td>
                  <td className="py-1.5 text-right">{p.fielding}</td>
                  <td className="py-1.5 text-right">${p.salary.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Pitchers */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">
          Pitchers ({pitchers.length})
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-gray-400">
                <th className="pb-2">#</th>
                <th className="pb-2">Name</th>
                <th className="pb-2">Slot</th>
                <th className="pb-2">Status</th>
                <th className="pb-2"></th>
                <th className="pb-2 text-right">Age</th>
                <th className="pb-2 text-right">T</th>
                <th className="pb-2 text-right">STA</th>
                <th className="pb-2 text-right">AG</th>
                <th className="pb-2 text-right">EYE</th>
                <th className="pb-2 text-right">AVG</th>
                <th className="pb-2 text-right">STR</th>
                <th className="pb-2 text-right">DHR</th>
                <th className="pb-2 text-right">PI</th>
                <th className="pb-2 text-right">Salary</th>
              </tr>
            </thead>
            <tbody>
              {pitchers.map((p) => (
                <tr key={p.id} className={`border-b border-gray-800/50 ${p.roster_status === 'active' ? 'text-gray-300' : 'text-gray-500'}`}>
                  <td className="py-1.5">{p.jersey_no}</td>
                  <td className="py-1.5 font-medium">{p.first_name} {p.last_name}</td>
                  <td className="py-1.5">
                    {p.rotation_slot >= 1 && p.rotation_slot <= 5
                      ? `SP${p.rotation_slot}`
                      : p.rotation_slot > 5
                        ? 'RP'
                        : '—'}
                  </td>
                  <td className="py-1.5">
                    <span className={`rounded px-1.5 py-0.5 text-xs ${p.roster_status === 'active' ? 'bg-green-900/50 text-green-400' : 'bg-gray-800 text-gray-500'}`}>
                      {p.roster_status}
                    </span>
                  </td>
                  <td className="py-1.5">
                    {(p.roster_status === 'active' || p.roster_status === 'reserve') && (
                      <RosterToggle playerId={p.id} currentStatus={p.roster_status} />
                    )}
                  </td>
                  <td className="py-1.5 text-right">{p.age}</td>
                  <td className="py-1.5 text-right">{HAND_LABEL[p.hand_throw]}</td>
                  <td className="py-1.5 text-right">{p.stamina}</td>
                  <td className="py-1.5 text-right">{p.ag}</td>
                  <td className="py-1.5 text-right">{p.eye}</td>
                  <td className="py-1.5 text-right">{p.avg}</td>
                  <td className="py-1.5 text-right">{p.strength}</td>
                  <td className="py-1.5 text-right">{p.dhr}</td>
                  <td className="py-1.5 text-right">{p.play_intel}</td>
                  <td className="py-1.5 text-right">${p.salary.toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
