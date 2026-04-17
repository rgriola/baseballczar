import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireMyTeam } from '@/lib/queries/team';

export default async function SchedulePage() {
  const team = await requireMyTeam();
  const supabase = await createClient();

  // Fetch all schedule entries for this team
  const { data: schedule } = await supabase
    .from('schedules')
    .select('id, home_team_id, visitor_team_id, game_time, played')
    .eq('league_id', team.league_id!)
    .or(`home_team_id.eq.${team.id},visitor_team_id.eq.${team.id}`)
    .order('game_time');

  // Fetch game results for played games
  const playedIds = schedule?.filter((s) => s.played).map((s) => s.id) ?? [];
  const { data: games } = playedIds.length > 0
    ? await supabase
        .from('games')
        .select('id, schedule_id, home_runs, visitor_runs')
        .in('schedule_id', playedIds)
    : { data: [] };
  const gameMap = new Map(games?.map((g) => [g.schedule_id, g]) ?? []);

  // Team names lookup
  const teamIds = new Set<number>();
  schedule?.forEach((s) => { teamIds.add(s.home_team_id); teamIds.add(s.visitor_team_id); });
  const { data: teams } = await supabase
    .from('teams')
    .select('id, team_name')
    .in('id', Array.from(teamIds));
  const nameMap = new Map(teams?.map((t) => [t.id, t.team_name]) ?? []);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">{team.team_name} — Schedule</h1>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left text-gray-400">
              <th className="pb-2">Date</th>
              <th className="pb-2">Opponent</th>
              <th className="pb-2 text-center">H/A</th>
              <th className="pb-2 text-right">Result</th>
            </tr>
          </thead>
          <tbody>
            {schedule?.map((s) => {
              const isHome = s.home_team_id === team.id;
              const opponentId = isHome ? s.visitor_team_id : s.home_team_id;
              const opponent = nameMap.get(opponentId) ?? '?';
              const when = new Date(s.game_time).toLocaleDateString('en-US', {
                weekday: 'short', month: 'short', day: 'numeric',
              });
              const game = gameMap.get(s.id);
              let result = '';
              let resultClass = 'text-gray-500';
              if (game) {
                const myRuns = isHome ? game.home_runs : game.visitor_runs;
                const oppRuns = isHome ? game.visitor_runs : game.home_runs;
                const won = myRuns > oppRuns;
                result = `${won ? 'W' : 'L'} ${myRuns}-${oppRuns}`;
                resultClass = won ? 'text-green-400' : 'text-red-400';
              }

              return (
                <tr key={s.id} className="border-b border-gray-800/50 text-gray-300">
                  <td className="py-1.5">{when}</td>
                  <td className="py-1.5">{opponent}</td>
                  <td className="py-1.5 text-center">{isHome ? 'H' : 'A'}</td>
                  <td className={`py-1.5 text-right font-mono ${resultClass}`}>
                    {game ? (
                      <Link href={`/dashboard/games/${game.id}`} className="hover:underline">
                        {result}
                      </Link>
                    ) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
