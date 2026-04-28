import { createClient } from '@/lib/supabase/server';
import { requireMyTeam } from '@/lib/queries/team';

export default async function O2ORecordsPage() {
  const supabase = await createClient();
  const team = await requireMyTeam();

  // All O2O records involving my team
  const { data: records } = await supabase
    .from('o2o_records')
    .select('id, team_a_id, team_b_id, wins_a, wins_b, updated_at')
    .or(`team_a_id.eq.${team.id},team_b_id.eq.${team.id}`)
    .order('updated_at', { ascending: false });

  // Get team names
  const teamIds = Array.from(
    new Set((records ?? []).flatMap((r) => [r.team_a_id, r.team_b_id])),
  );

  const { data: teams } = await supabase
    .from('teams')
    .select('id, team_name')
    .in('id', teamIds.length > 0 ? teamIds : [0]);

  const teamMap = Object.fromEntries((teams ?? []).map((t) => [t.id, t.team_name]));

  // Calculate totals
  let totalWins = 0;
  let totalLosses = 0;

  const enriched = (records ?? []).map((r) => {
    const iAmA = r.team_a_id === team.id;
    const myWins = iAmA ? r.wins_a : r.wins_b;
    const theirWins = iAmA ? r.wins_b : r.wins_a;
    const opponentId = iAmA ? r.team_b_id : r.team_a_id;

    totalWins += myWins;
    totalLosses += theirWins;

    return {
      opponentName: teamMap[opponentId] ?? 'Unknown',
      myWins,
      theirWins,
      updatedAt: r.updated_at,
    };
  });

  return (
    <div>
      <h1 className="text-2xl font-bold mb-2">O2O Records</h1>
      <p className="text-gray-400 mb-4">
        Overall: <span className="text-green-400 font-semibold">{totalWins}W</span>
        {' - '}
        <span className="text-red-400 font-semibold">{totalLosses}L</span>
      </p>

      {enriched.length === 0 ? (
        <p className="text-gray-500">No O2O games played yet.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-700 text-gray-400">
              <th className="text-left py-2">Opponent</th>
              <th className="text-center py-2">W</th>
              <th className="text-center py-2">L</th>
              <th className="text-right py-2">Last Played</th>
            </tr>
          </thead>
          <tbody>
            {enriched.map((r, i) => (
              <tr key={i} className="border-b border-gray-800">
                <td className="py-2 font-semibold">{r.opponentName}</td>
                <td className="text-center text-green-400">{r.myWins}</td>
                <td className="text-center text-red-400">{r.theirWins}</td>
                <td className="text-right text-gray-500 text-xs">
                  {new Date(r.updatedAt).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
