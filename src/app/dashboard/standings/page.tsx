import { createClient } from '@/lib/supabase/server';
import { requireMyTeam } from '@/lib/queries/team';

export default async function StandingsPage() {
  const team = await requireMyTeam();
  const supabase = await createClient();

  const { data: standings } = await supabase
    .from('standings')
    .select(`
      team_id, w, l,
      r, h, hr, ab, bb, so, rbi, era_runs, era_outs,
      teams(team_name)
    `)
    .eq('league_id', team.league_id!)
    .order('w', { ascending: false });

  function pct(w: number, l: number) {
    return w + l > 0 ? (w / (w + l)).toFixed(3) : '.000';
  }
  function teamEra(er: number, outs: number) {
    const ip = outs / 3;
    return ip > 0 ? ((er / ip) * 9).toFixed(2) : '0.00';
  }
  function gb(topW: number, topL: number, w: number, l: number) {
    const diff = ((topW - w) + (l - topL)) / 2;
    return diff === 0 ? '—' : diff.toFixed(1);
  }

  const topW = standings?.[0]?.w ?? 0;
  const topL = standings?.[0]?.l ?? 0;

  // Load O2O records for all teams in the league
  const teamIds = (standings ?? []).map((s) => s.team_id);
  const { data: o2oRecords } = await supabase
    .from('o2o_records')
    .select('team_a_id, team_b_id, wins_a, wins_b')
    .or(
      teamIds.map((id) => `team_a_id.eq.${id},team_b_id.eq.${id}`).join(','),
    );

  // Aggregate O2O W-L per team
  const o2oMap: Record<number, { w: number; l: number }> = {};
  for (const tid of teamIds) {
    o2oMap[tid] = { w: 0, l: 0 };
  }
  for (const r of o2oRecords ?? []) {
    if (o2oMap[r.team_a_id]) {
      o2oMap[r.team_a_id].w += r.wins_a;
      o2oMap[r.team_a_id].l += r.wins_b;
    }
    if (o2oMap[r.team_b_id]) {
      o2oMap[r.team_b_id].w += r.wins_b;
      o2oMap[r.team_b_id].l += r.wins_a;
    }
  }

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-white">League Standings</h1>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left text-gray-400">
              <th className="pb-2">Team</th>
              <th className="pb-2 text-right">W</th>
              <th className="pb-2 text-right">L</th>
              <th className="pb-2 text-right">Pct</th>
              <th className="pb-2 text-right">GB</th>
              <th className="pb-2 text-right">RS</th>
              <th className="pb-2 text-right">H</th>
              <th className="pb-2 text-right">HR</th>
              <th className="pb-2 text-right">ERA</th>
              <th className="pb-2 text-right">O2O</th>
            </tr>
          </thead>
          <tbody>
            {standings?.map((s) => {
              const name = (s.teams as unknown as { team_name: string })?.team_name ?? '?';
              const isMe = s.team_id === team.id;
              return (
                <tr key={s.team_id} className={`border-b border-gray-800/50 ${isMe ? 'text-blue-400 font-semibold' : 'text-gray-300'}`}>
                  <td className="py-1.5">{name}</td>
                  <td className="py-1.5 text-right">{s.w}</td>
                  <td className="py-1.5 text-right">{s.l}</td>
                  <td className="py-1.5 text-right font-mono">{pct(s.w, s.l)}</td>
                  <td className="py-1.5 text-right">{gb(topW, topL, s.w, s.l)}</td>
                  <td className="py-1.5 text-right">{s.r}</td>
                  <td className="py-1.5 text-right">{s.h}</td>
                  <td className="py-1.5 text-right">{s.hr}</td>
                  <td className="py-1.5 text-right font-mono">{teamEra(s.era_runs ?? 0, s.era_outs ?? 0)}</td>
                  <td className="py-1.5 text-right text-xs">{o2oMap[s.team_id] ? `${o2oMap[s.team_id].w}-${o2oMap[s.team_id].l}` : '0-0'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
