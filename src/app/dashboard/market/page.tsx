import { createClient } from '@/lib/supabase/server';
import { requireMyTeam } from '@/lib/queries/team';
import { playerValueFromRow } from '@/lib/finance';
import SignPlayerButton from './sign-player-button';

const POSITIONS = [
  'All', 'C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'SP', 'RP',
];

function money(v: number) {
  return `$${v.toLocaleString()}`;
}

export default async function MarketPage({
  searchParams,
}: {
  searchParams: Promise<{ pos?: string; minSkill?: string; maxSalary?: string }>;
}) {
  const params = await searchParams;
  const team = await requireMyTeam();
  const supabase = await createClient();

  // Build query for free agents
  let query = supabase
    .from('players')
    .select('id, first_name, last_name, position, fielder, age, salary, contract, speed, stamina, play_intel, avg, strength, eye, bunting, throw, fielding')
    .eq('roster_status', 'free_agent')
    .order('salary', { ascending: false })
    .limit(100);

  // Position filter
  const posFilter = params.pos ?? 'All';
  if (posFilter !== 'All') {
    query = query.eq('position', posFilter);
  }

  // Max salary filter
  if (params.maxSalary) {
    const max = parseInt(params.maxSalary, 10);
    if (!isNaN(max)) {
      query = query.lte('salary', max);
    }
  }

  const { data: players } = await query;

  // Min skill total filter (client-side since it's a computed field)
  const minSkill = params.minSkill ? parseInt(params.minSkill, 10) : 0;

  const enriched = (players ?? [])
    .map((p) => ({
      ...p,
      skillTotal:
        p.speed + p.stamina + p.play_intel + p.avg + p.strength +
        p.eye + p.bunting + p.throw + p.fielding,
      value: playerValueFromRow(p),
    }))
    .filter((p) => p.skillTotal >= minSkill);

  // Get team's current budget
  const { data: budget } = await supabase
    .from('team_budgets')
    .select('balance')
    .eq('team_id', team.id)
    .single();

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-white">Free Agent Market</h1>
        <p className="text-sm text-gray-400">
          Budget: <span className="font-mono text-white">{money(budget?.balance ?? 0)}</span>
        </p>
      </div>

      {/* Filters */}
      <form className="flex flex-wrap gap-3">
        <select
          name="pos"
          defaultValue={posFilter}
          className="rounded border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-white"
        >
          {POSITIONS.map((p) => (
            <option key={p} value={p}>{p}</option>
          ))}
        </select>
        <input
          name="minSkill"
          type="number"
          placeholder="Min skill total"
          defaultValue={params.minSkill ?? ''}
          className="w-36 rounded border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-white placeholder-gray-600"
        />
        <input
          name="maxSalary"
          type="number"
          placeholder="Max salary"
          defaultValue={params.maxSalary ?? ''}
          className="w-36 rounded border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-white placeholder-gray-600"
        />
        <button
          type="submit"
          className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
        >
          Filter
        </button>
      </form>

      {/* Results */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left text-gray-400">
              <th className="pb-2">Player</th>
              <th className="pb-2">Pos</th>
              <th className="pb-2 text-right">Age</th>
              <th className="pb-2 text-right">SPD</th>
              <th className="pb-2 text-right">STM</th>
              <th className="pb-2 text-right">PI</th>
              <th className="pb-2 text-right">AVG</th>
              <th className="pb-2 text-right">STR</th>
              <th className="pb-2 text-right">EYE</th>
              <th className="pb-2 text-right">BNT</th>
              <th className="pb-2 text-right">THR</th>
              <th className="pb-2 text-right">FLD</th>
              <th className="pb-2 text-right">Total</th>
              <th className="pb-2 text-right">Value</th>
              <th className="pb-2 text-right">Salary</th>
              <th className="pb-2"></th>
            </tr>
          </thead>
          <tbody>
            {enriched.map((p) => (
              <tr key={p.id} className="border-b border-gray-800/50 text-gray-300">
                <td className="py-1.5 whitespace-nowrap">
                  {p.first_name} {p.last_name}
                </td>
                <td className="py-1.5">{p.position}</td>
                <td className="py-1.5 text-right">{p.age}</td>
                <td className="py-1.5 text-right">{p.speed}</td>
                <td className="py-1.5 text-right">{p.stamina}</td>
                <td className="py-1.5 text-right">{p.play_intel}</td>
                <td className="py-1.5 text-right">{p.avg}</td>
                <td className="py-1.5 text-right">{p.strength}</td>
                <td className="py-1.5 text-right">{p.eye}</td>
                <td className="py-1.5 text-right">{p.bunting}</td>
                <td className="py-1.5 text-right">{p.throw}</td>
                <td className="py-1.5 text-right">{p.fielding}</td>
                <td className="py-1.5 text-right font-mono">{p.skillTotal}</td>
                <td className="py-1.5 text-right font-mono text-yellow-400">
                  {money(p.value)}
                </td>
                <td className="py-1.5 text-right font-mono">{money(p.salary)}</td>
                <td className="py-1.5 text-right">
                  <SignPlayerButton
                    playerId={p.id}
                    playerName={`${p.first_name} ${p.last_name}`}
                    salary={p.salary}
                    canAfford={(budget?.balance ?? 0) >= p.salary}
                  />
                </td>
              </tr>
            ))}
            {enriched.length === 0 && (
              <tr>
                <td colSpan={16} className="py-8 text-center text-gray-500">
                  No free agents match your filters.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-gray-600">
        Showing {enriched.length} free agents. Value = $22,000 × skill total.
      </p>
    </div>
  );
}
