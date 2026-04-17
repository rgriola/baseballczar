import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { getMyTeam } from '@/lib/queries/team';
import ProvisionButton from './provision-button';

export default async function DashboardPage() {
  const team = await getMyTeam();
  const supabase = await createClient();

  if (!team || !team.league_id) {
    return (
      <div>
        <h1 className="text-2xl font-bold text-white">Front Office</h1>
        <p className="mt-4 text-gray-400">
          You do not have a team yet. Click below to create one and join a league.
        </p>
        <ProvisionButton />
      </div>
    );
  }

  const { data: standings } = await supabase
    .from('standings')
    .select('team_id, w, l, teams(team_name)')
    .eq('league_id', team.league_id)
    .order('w', { ascending: false });

  const { data: upcoming } = await supabase
    .from('schedules')
    .select('id, home_team_id, visitor_team_id, game_time, played')
    .eq('league_id', team.league_id)
    .eq('played', false)
    .or(`home_team_id.eq.${team.id},visitor_team_id.eq.${team.id}`)
    .order('game_time')
    .limit(5);

  const teamIds = new Set<number>();
  upcoming?.forEach((g) => {
    teamIds.add(g.home_team_id);
    teamIds.add(g.visitor_team_id);
  });
  const { data: teamNames } = await supabase
    .from('teams')
    .select('id, team_name')
    .in('id', Array.from(teamIds));
  const nameMap = new Map(teamNames?.map((t) => [t.id, t.team_name]) ?? []);

  const { data: recent } = await supabase
    .from('games')
    .select('id, home_team_id, visitor_team_id, home_runs, visitor_runs, played_at')
    .eq('league_id', team.league_id)
    .or(`home_team_id.eq.${team.id},visitor_team_id.eq.${team.id}`)
    .order('played_at', { ascending: false })
    .limit(5);

  const myStanding = standings?.find((s) => s.team_id === team.id);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-white">
          {team.team_name} — Front Office
        </h1>
        {myStanding && (
          <p className="mt-1 text-lg text-gray-400">
            Record: {myStanding.w}-{myStanding.l}
          </p>
        )}
      </div>

      <div className="grid gap-8 lg:grid-cols-2">
        <section>
          <h2 className="mb-3 text-lg font-semibold text-white">
            League Standings
          </h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-gray-400">
                <th className="pb-2">Team</th>
                <th className="pb-2 text-right">W</th>
                <th className="pb-2 text-right">L</th>
                <th className="pb-2 text-right">Pct</th>
              </tr>
            </thead>
            <tbody>
              {standings?.map((s) => {
                const name =
                  (s.teams as unknown as { team_name: string })?.team_name ??
                  '?';
                const pct =
                  s.w + s.l > 0
                    ? (s.w / (s.w + s.l)).toFixed(3)
                    : '.000';
                const isMe = s.team_id === team.id;
                return (
                  <tr
                    key={s.team_id}
                    className={`border-b border-gray-800/50 ${isMe ? 'text-blue-400' : 'text-gray-300'}`}
                  >
                    <td className="py-1.5">{name}</td>
                    <td className="py-1.5 text-right">{s.w}</td>
                    <td className="py-1.5 text-right">{s.l}</td>
                    <td className="py-1.5 text-right">{pct}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <div className="space-y-8">
          <section>
            <h2 className="mb-3 text-lg font-semibold text-white">
              Upcoming Games
            </h2>
            {!upcoming || upcoming.length === 0 ? (
              <p className="text-sm text-gray-500">No upcoming games</p>
            ) : (
              <div className="space-y-2">
                {upcoming.map((g) => {
                  const isHome = g.home_team_id === team.id;
                  const opponent =
                    nameMap.get(
                      isHome ? g.visitor_team_id : g.home_team_id,
                    ) ?? '?';
                  const when = new Date(g.game_time).toLocaleDateString(
                    'en-US',
                    {
                      weekday: 'short',
                      month: 'short',
                      day: 'numeric',
                      hour: 'numeric',
                      minute: '2-digit',
                    },
                  );
                  return (
                    <div
                      key={g.id}
                      className="flex items-center justify-between rounded bg-gray-900 px-4 py-2 text-sm"
                    >
                      <span className="text-gray-300">
                        {isHome ? 'vs' : '@'}{' '}
                        <span className="text-white">{opponent}</span>
                      </span>
                      <span className="text-gray-500">{when}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section>
            <h2 className="mb-3 text-lg font-semibold text-white">
              Recent Results
            </h2>
            {!recent || recent.length === 0 ? (
              <p className="text-sm text-gray-500">No games played yet</p>
            ) : (
              <div className="space-y-2">
                {recent.map((g) => {
                  const isHome = g.home_team_id === team.id;
                  const myRuns = isHome ? g.home_runs : g.visitor_runs;
                  const oppRuns = isHome ? g.visitor_runs : g.home_runs;
                  const won = myRuns > oppRuns;
                  const opponent =
                    nameMap.get(
                      isHome ? g.visitor_team_id : g.home_team_id,
                    ) ?? '?';
                  return (
                    <Link
                      key={g.id}
                      href={`/dashboard/games/${g.id}`}
                      className="flex items-center justify-between rounded bg-gray-900 px-4 py-2 text-sm hover:bg-gray-800"
                    >
                      <span className="text-gray-300">
                        <span
                          className={
                            won ? 'text-green-400' : 'text-red-400'
                          }
                        >
                          {won ? 'W' : 'L'}
                        </span>{' '}
                        {isHome ? 'vs' : '@'} {opponent}
                      </span>
                      <span className="text-white">
                        {myRuns}-{oppRuns}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
