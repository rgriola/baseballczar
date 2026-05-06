// Last touched by agent: 2026-05-05T20:40:54Z
import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireMyTeam } from '@/lib/queries/team';

export const revalidate = 60;

const PAGE_SIZE = 10;

type ScheduleSearchParams = {
  page?: string;
  teamId?: string;
};

function parsePositiveInt(value?: string): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function buildScheduleHref(page: number, teamId: number | null): string {
  const query = new URLSearchParams();
  if (teamId) query.set('teamId', String(teamId));
  if (page > 1) query.set('page', String(page));
  const qs = query.toString();
  return qs ? `/dashboard/schedule?${qs}` : '/dashboard/schedule';
}

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<ScheduleSearchParams>;
}) {
  const params = await searchParams;
  const team = await requireMyTeam();
  const supabase = await createClient();
  const leagueId = team.league_id;

  if (!leagueId) {
    return (
      <div className="rounded-lg border border-red-800/40 bg-red-950/20 px-4 py-3 text-sm text-red-200">
        Team is not assigned to a league yet.
      </div>
    );
  }

  // Team list is used for both name mapping and filter options.
  const { data: leagueTeams } = await supabase
    .from('teams')
    .select('id, team_name')
    .eq('league_id', leagueId)
    .order('team_name');

  const validTeamIds = new Set((leagueTeams ?? []).map((t) => t.id));
  const requestedTeamId = parsePositiveInt(params.teamId);
  const selectedTeamId = requestedTeamId && validTeamIds.has(requestedTeamId)
    ? requestedTeamId
    : null;

  let countQuery = supabase
    .from('schedules')
    .select('id', { count: 'exact', head: true })
    .eq('league_id', leagueId);

  if (selectedTeamId) {
    countQuery = countQuery.or(`home_team_id.eq.${selectedTeamId},visitor_team_id.eq.${selectedTeamId}`);
  }

  const { count: totalCount } = await countQuery;
  const totalGames = totalCount ?? 0;
  const totalPages = Math.max(1, Math.ceil(totalGames / PAGE_SIZE));
  const requestedPage = parsePositiveInt(params.page) ?? 1;
  const currentPage = Math.min(requestedPage, totalPages);
  const pageStart = (currentPage - 1) * PAGE_SIZE;

  let scheduleQuery = supabase
    .from('schedules')
    .select('id, home_team_id, visitor_team_id, game_time, played')
    .eq('league_id', leagueId);

  if (selectedTeamId) {
    scheduleQuery = scheduleQuery.or(`home_team_id.eq.${selectedTeamId},visitor_team_id.eq.${selectedTeamId}`);
  }

  const { data: schedule } = await scheduleQuery
    .order('game_time')
    .range(pageStart, pageStart + PAGE_SIZE - 1);

  // Fetch game results for played games
  const playedIds = schedule?.filter((s) => s.played).map((s) => s.id) ?? [];
  const { data: games } = playedIds.length > 0
    ? await supabase
        .from('games')
        .select('id, schedule_id, home_runs, visitor_runs')
        .in('schedule_id', playedIds)
    : { data: [] };
  const gameMap = new Map(games?.map((g) => [g.schedule_id, g]) ?? []);
  const nameMap = new Map((leagueTeams ?? []).map((t) => [t.id, t.team_name]));

  const prevHref = buildScheduleHref(currentPage - 1, selectedTeamId);
  const nextHref = buildScheduleHref(currentPage + 1, selectedTeamId);
  const hasPrev = currentPage > 1;
  const hasNext = currentPage < totalPages;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-white">League Schedule</h1>
        <div className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm font-mono text-zinc-300">
          League #{leagueId}
        </div>
      </div>

      <form className="flex flex-wrap items-center gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2">
        <label htmlFor="teamId" className="text-sm text-zinc-300">Team</label>
        <select
          id="teamId"
          name="teamId"
          defaultValue={selectedTeamId ? String(selectedTeamId) : ''}
          className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-white"
        >
          <option value="">All Teams</option>
          {(leagueTeams ?? []).map((leagueTeam) => (
            <option key={leagueTeam.id} value={leagueTeam.id}>{leagueTeam.team_name}</option>
          ))}
        </select>
        <button
          type="submit"
          className="rounded bg-blue-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-blue-500"
        >
          Filter
        </button>
        {selectedTeamId && (
          <Link
            href="/dashboard/schedule"
            className="rounded border border-zinc-700 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-800"
          >
            Clear
          </Link>
        )}
      </form>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left text-gray-400">
              <th className="pb-2">Game #</th>
              <th className="pb-2">Game Date</th>
              <th className="pb-2">Matchup</th>
              <th className="pb-2 text-center">Score</th>
              <th className="pb-2 text-center">Box</th>
              <th className="pb-2 text-center">Replay</th>
            </tr>
          </thead>
          <tbody>
            {schedule?.map((s) => {
              const awayName = nameMap.get(s.visitor_team_id) ?? 'Visitor';
              const homeName = nameMap.get(s.home_team_id) ?? 'Home';
              const when = new Date(s.game_time).toLocaleDateString('en-US', {
                month: 'short', day: 'numeric', year: 'numeric',
              });
              const game = gameMap.get(s.id);
              const score = game ? `${game.visitor_runs}-${game.home_runs}` : '--';
              const boxHref = game ? `/dashboard/games/${game.id}?view=box` : null;
              const replayHref = game ? `/dashboard/games/${game.id}?view=replay` : null;

              return (
                <tr key={s.id} className="border-b border-gray-800/50 text-gray-300">
                  <td className="py-2 font-mono text-zinc-400">{s.id}</td>
                  <td className="py-2">{when}</td>
                  <td className="py-2 text-zinc-200">
                    {awayName} @ {homeName}
                  </td>
                  <td className="py-2 text-center font-mono text-zinc-100">{score}</td>
                  <td className="py-2 text-center">
                    {boxHref ? (
                      <Link
                        href={boxHref}
                        className="inline-flex rounded border border-zinc-600 px-2 py-1 text-xs text-zinc-200 hover:bg-zinc-800"
                      >
                        Box
                      </Link>
                    ) : (
                      <span className="inline-flex cursor-not-allowed rounded border border-zinc-800 px-2 py-1 text-xs text-zinc-600">
                        Box
                      </span>
                    )}
                  </td>
                  <td className="py-2 text-center">
                    {replayHref ? (
                      <Link
                        href={replayHref}
                        className="inline-flex rounded bg-blue-700 px-2 py-1 text-xs text-white hover:bg-blue-600"
                      >
                        Replay
                      </Link>
                    ) : (
                      <span className="inline-flex cursor-not-allowed rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-600">
                        Replay
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}

            {(!schedule || schedule.length === 0) && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-sm text-zinc-500">
                  No games found for the selected filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-zinc-400">
        <div>
          Showing {totalGames === 0 ? 0 : pageStart + 1}-{Math.min(pageStart + PAGE_SIZE, totalGames)} of {totalGames}
        </div>
        <div className="flex items-center gap-2">
          {hasPrev ? (
            <Link
              href={prevHref}
              className="rounded border border-zinc-700 px-3 py-1.5 hover:bg-zinc-800"
            >
              Prev
            </Link>
          ) : (
            <span className="cursor-not-allowed rounded border border-zinc-800 px-3 py-1.5 text-zinc-600">Prev</span>
          )}
          <span className="rounded border border-zinc-800 bg-zinc-900 px-3 py-1.5 font-mono text-zinc-300">
            Page {currentPage} of {totalPages}
          </span>
          {hasNext ? (
            <Link
              href={nextHref}
              className="rounded border border-zinc-700 px-3 py-1.5 hover:bg-zinc-800"
            >
              Next
            </Link>
          ) : (
            <span className="cursor-not-allowed rounded border border-zinc-800 px-3 py-1.5 text-zinc-600">Next</span>
          )}
        </div>
      </div>
    </div>
  );
}
