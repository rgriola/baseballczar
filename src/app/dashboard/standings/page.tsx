import { createClient } from '@/lib/supabase/server';
import { requireMyTeam } from '@/lib/queries/team';

export default async function StandingsPage() {
  const team = await requireMyTeam();
  const supabase = await createClient();

  const { data: standings } = await supabase
    .from('standings')
    .select(`
      team_id, w, l,
      team_runs, team_hits, team_hr, team_era_runs, team_era_outs,
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
                  <td className="py-1.5 text-right">{s.team_runs}</td>
                  <td className="py-1.5 text-right">{s.team_hits}</td>
                  <td className="py-1.5 text-right">{s.team_hr}</td>
                  <td className="py-1.5 text-right font-mono">{teamEra(s.team_era_runs, s.team_era_outs)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
