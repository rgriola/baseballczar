import Link from 'next/link';
import { createClient } from '@/lib/supabase/server';
import { requireMyTeam } from '@/lib/queries/team';

export const revalidate = 60;

const PAGE_SIZE = 10;

type ScheduleSearchParams = {
  page?: string;
  teamId?: string;
  sort?: string;
};

function parsePositiveInt(value?: string): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

type SortMode = 'next' | 'last';

function buildScheduleHref(
  page: number,
  teamId: number | null,
  sort: SortMode,
): string {
  const query = new URLSearchParams();
  if (teamId) query.set('teamId', String(teamId));
  if (page > 1) query.set('page', String(page));
  if (sort !== 'next') query.set('sort', sort);
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

  const sortMode: SortMode = params.sort === 'last' ? 'last' : 'next';

  // Other teams for the dropdown (exclude the user's team since it has its own button)
  const otherTeams = (leagueTeams ?? []).filter((t) => t.id !== team.id);

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

  // Sort: "next" = unplayed first (asc date), "last" = played first (desc date)
  if (sortMode === 'last') {
    scheduleQuery = scheduleQuery
      .order('played', { ascending: false })
      .order('game_time', { ascending: false });
  } else {
    scheduleQuery = scheduleQuery
      .order('played', { ascending: true })
      .order('game_time', { ascending: true });
  }

  const { data: schedule } = await scheduleQuery
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

  const prevHref = buildScheduleHref(currentPage - 1, selectedTeamId, sortMode);
  const nextHref = buildScheduleHref(currentPage + 1, selectedTeamId, sortMode);
  const hasPrev = currentPage > 1;
  const hasNext = currentPage < totalPages;

  // Active button style helper
  const btnBase = 'rounded px-3 py-1.5 text-sm font-medium transition-colors';
  const btnActive = 'bg-blue-600 text-white';
  const btnInactive = 'border border-zinc-700 text-zinc-300 hover:bg-zinc-800';

  return (
    <div className="space-y-5">
      {/* ─── Header ─── */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-2xl font-bold text-white">League Schedule</h1>
        <div className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm font-mono text-zinc-300">
          League #{leagueId}
        </div>
      </div>

      {/* ─── Filter Bar ─── */}
      <div className="flex flex-wrap items-center gap-2 rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2.5">
        {/* Quick-filter buttons */}
        <Link
          href={buildScheduleHref(1, null, sortMode)}
          className={`${btnBase} ${!selectedTeamId ? btnActive : btnInactive}`}
        >
          League Schedule
        </Link>
        <Link
          href={buildScheduleHref(1, team.id, sortMode)}
          className={`${btnBase} ${selectedTeamId === team.id ? btnActive : btnInactive}`}
        >
          {team.team_name}
        </Link>

        {/* Separator */}
        <div className="mx-1 h-6 w-px bg-zinc-700" />

        {/* Other teams dropdown */}
        <form className="flex items-center gap-2">
          <input type="hidden" name="sort" value={sortMode} />
          <select
            id="teamId"
            name="teamId"
            defaultValue={selectedTeamId && selectedTeamId !== team.id ? String(selectedTeamId) : ''}
            className="rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-white"
          >
            <option value="">Other Teams…</option>
            {otherTeams.map((t) => (
              <option key={t.id} value={t.id}>{t.team_name}</option>
            ))}
          </select>
          <button type="submit" className={`${btnBase} ${btnInactive}`}>Go</button>
        </form>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Sort toggle */}
        <div className="flex overflow-hidden rounded border border-zinc-700">
          <Link
            href={buildScheduleHref(1, selectedTeamId, 'next')}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              sortMode === 'next'
                ? 'bg-blue-600 text-white'
                : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            Next Game
          </Link>
          <Link
            href={buildScheduleHref(1, selectedTeamId, 'last')}
            className={`px-3 py-1.5 text-xs font-medium transition-colors ${
              sortMode === 'last'
                ? 'bg-blue-600 text-white'
                : 'bg-zinc-900 text-zinc-300 hover:bg-zinc-800'
            }`}
          >
            Last Played
          </Link>
        </div>
      </div>

      {/* ─── Table ─── */}
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
              <th className="pb-2 text-center">Manage</th>
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
              const isMyGame = s.home_team_id === team.id || s.visitor_team_id === team.id;

              return (
                <tr key={s.id} className={`border-b border-gray-800/50 ${isMyGame && !s.played ? 'text-white' : 'text-gray-300'}`}>
                  <td className="py-2 font-mono text-zinc-400">{s.id}</td>
                  <td className="py-2">{when}</td>
                  <td className="py-2">
                    <span className={s.visitor_team_id === team.id ? 'font-semibold text-blue-300' : ''}>
                      {awayName}
                    </span>
                    {' @ '}
                    <span className={s.home_team_id === team.id ? 'font-semibold text-blue-300' : ''}>
                      {homeName}
                    </span>
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
                  <td className="py-2 text-center">
                    {!s.played && isMyGame ? (
                      <div className="flex justify-center gap-1">
                        <Link
                          href={`/dashboard/schedule/${s.id}/lineup`}
                          className="inline-flex rounded border border-amber-600/60 px-2 py-1 text-xs text-amber-200 hover:bg-amber-900/30"
                        >
                          Lineup
                        </Link>
                        <Link
                          href={`/dashboard/schedule/${s.id}/pitchers`}
                          className="inline-flex rounded border border-amber-600/60 px-2 py-1 text-xs text-amber-200 hover:bg-amber-900/30"
                        >
                          Pitchers
                        </Link>
                      </div>
                    ) : (
                      <span className="text-xs text-zinc-600">—</span>
                    )}
                  </td>
                </tr>
              );
            })}

            {(!schedule || schedule.length === 0) && (
              <tr>
                <td colSpan={7} className="py-6 text-center text-sm text-zinc-500">
                  No games found for the selected filter.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* ─── Pagination ─── */}
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
