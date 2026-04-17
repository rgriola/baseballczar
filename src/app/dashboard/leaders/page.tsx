import { createClient } from '@/lib/supabase/server';
import { requireMyTeam } from '@/lib/queries/team';

export default async function LeadersPage() {
  const team = await requireMyTeam();
  const supabase = await createClient();

  // Get all teams in league for name lookup
  const { data: leagueTeams } = await supabase
    .from('teams')
    .select('id, team_name')
    .eq('league_id', team.league_id!);
  const teamIds = leagueTeams?.map((t) => t.id) ?? [];
  const teamNameMap = new Map(leagueTeams?.map((t) => [t.id, t.team_name]) ?? []);

  // Fetch hitting stats for entire league
  const { data: hitting } = await supabase
    .from('player_stats_hitting')
    .select('player_id, team_id, pa, ab, hits, hr, rbi, runs, bb, so, sb, doubles, triples, players(first_name, last_name)')
    .in('team_id', teamIds)
    .order('pa', { ascending: false });

  // Fetch pitching stats for entire league
  const { data: pitching } = await supabase
    .from('player_stats_pitching')
    .select('player_id, team_id, w, l, sv, ip_outs, er, so_pitched, bb_allowed, hits_allowed, cg, sho, players(first_name, last_name)')
    .in('team_id', teamIds)
    .order('ip_outs', { ascending: false });

  // Helper to sort + slice top 10
  function top<T>(arr: T[] | null, sortFn: (a: T, b: T) => number, filterFn?: (a: T) => boolean): T[] {
    let filtered = arr ?? [];
    if (filterFn) filtered = filtered.filter(filterFn);
    return [...filtered].sort(sortFn).slice(0, 10);
  }

  type HitStat = NonNullable<typeof hitting>[number];
  type PitchStat = NonNullable<typeof pitching>[number];

  const hName = (s: HitStat) => {
    const p = s.players as unknown as { first_name: string; last_name: string };
    return `${p.first_name} ${p.last_name}`;
  };
  const pName = (s: PitchStat) => {
    const p = s.players as unknown as { first_name: string; last_name: string };
    return `${p.first_name} ${p.last_name}`;
  };

  const categories = [
    { title: 'Batting Average', data: top(hitting, (a, b) => (b.hits / Math.max(b.ab, 1)) - (a.hits / Math.max(a.ab, 1)), (s) => s.ab >= 10), render: (s: HitStat) => ({ name: hName(s), team: teamNameMap.get(s.team_id) ?? '?', value: (s.hits / s.ab).toFixed(3) }) },
    { title: 'Home Runs', data: top(hitting, (a, b) => b.hr - a.hr), render: (s: HitStat) => ({ name: hName(s), team: teamNameMap.get(s.team_id) ?? '?', value: String(s.hr) }) },
    { title: 'RBI', data: top(hitting, (a, b) => b.rbi - a.rbi), render: (s: HitStat) => ({ name: hName(s), team: teamNameMap.get(s.team_id) ?? '?', value: String(s.rbi) }) },
    { title: 'Runs', data: top(hitting, (a, b) => b.runs - a.runs), render: (s: HitStat) => ({ name: hName(s), team: teamNameMap.get(s.team_id) ?? '?', value: String(s.runs) }) },
    { title: 'Stolen Bases', data: top(hitting, (a, b) => b.sb - a.sb), render: (s: HitStat) => ({ name: hName(s), team: teamNameMap.get(s.team_id) ?? '?', value: String(s.sb) }) },
    { title: 'Wins', data: top(pitching, (a, b) => b.w - a.w), render: (s: PitchStat) => ({ name: pName(s), team: teamNameMap.get(s.team_id) ?? '?', value: String(s.w) }) },
    { title: 'ERA', data: top(pitching, (a, b) => {
      const aEra = a.ip_outs > 0 ? (a.er / (a.ip_outs / 3)) * 9 : 999;
      const bEra = b.ip_outs > 0 ? (b.er / (b.ip_outs / 3)) * 9 : 999;
      return aEra - bEra;
    }, (s) => s.ip_outs >= 9), render: (s: PitchStat) => ({ name: pName(s), team: teamNameMap.get(s.team_id) ?? '?', value: ((s.er / (s.ip_outs / 3)) * 9).toFixed(2) }) },
    { title: 'Strikeouts', data: top(pitching, (a, b) => b.so_pitched - a.so_pitched), render: (s: PitchStat) => ({ name: pName(s), team: teamNameMap.get(s.team_id) ?? '?', value: String(s.so_pitched) }) },
    { title: 'Saves', data: top(pitching, (a, b) => b.sv - a.sv), render: (s: PitchStat) => ({ name: pName(s), team: teamNameMap.get(s.team_id) ?? '?', value: String(s.sv) }) },
  ];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">League Leaders</h1>

      {(!hitting || hitting.length === 0) && (!pitching || pitching.length === 0) ? (
        <p className="text-gray-500">No stats yet — games must be played first.</p>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {categories.map((cat) => (
            <section key={cat.title} className="rounded-lg bg-gray-900 p-4">
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-gray-400">
                {cat.title}
              </h2>
              <div className="space-y-1">
                {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                {(cat.data as any[]).map((s: any, i: number) => {
                  const r = cat.render(s);
                  return (
                    <div key={s.player_id} className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="w-5 text-right text-gray-600">{i + 1}</span>
                        <span className="text-gray-300">{r.name}</span>
                        <span className="text-xs text-gray-600">{r.team}</span>
                      </div>
                      <span className="font-mono text-white">{r.value}</span>
                    </div>
                  );
                })}
                {cat.data.length === 0 && (
                  <p className="text-xs text-gray-600">No qualifying data</p>
                )}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
