import { createClient } from '@/lib/supabase/server';
import { requireMyTeam } from '@/lib/queries/team';

export default async function StatsPage() {
  const team = await requireMyTeam();
  const supabase = await createClient();

  const { data: hitting } = await supabase
    .from('player_stats_hitting')
    .select('player_id, pa, ab, runs, hits, doubles, triples, hr, rbi, bb, so, sb, cs, players(first_name, last_name, jersey_no, position)')
    .eq('team_id', team.id)
    .order('pa', { ascending: false });

  const { data: pitching } = await supabase
    .from('player_stats_pitching')
    .select('player_id, w, l, sv, ip_outs, hits_allowed, runs_allowed, er, bb_allowed, so_pitched, hr_allowed, bf, cg, sho, players(first_name, last_name, jersey_no)')
    .eq('team_id', team.id)
    .order('ip_outs', { ascending: false });

  function ba(h: number, ab: number) {
    return ab > 0 ? (h / ab).toFixed(3) : '.000';
  }
  function era(er: number, ipOuts: number) {
    const ip = ipOuts / 3;
    return ip > 0 ? ((er / ip) * 9).toFixed(2) : '0.00';
  }
  function ipStr(outs: number) {
    return `${Math.floor(outs / 3)}.${outs % 3}`;
  }

  return (
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-white">{team.team_name} — Stats</h1>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">Hitting</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-gray-400">
                <th className="pb-2">Player</th>
                <th className="pb-2">Pos</th>
                <th className="pb-2 text-right">PA</th>
                <th className="pb-2 text-right">AB</th>
                <th className="pb-2 text-right">R</th>
                <th className="pb-2 text-right">H</th>
                <th className="pb-2 text-right">2B</th>
                <th className="pb-2 text-right">3B</th>
                <th className="pb-2 text-right">HR</th>
                <th className="pb-2 text-right">RBI</th>
                <th className="pb-2 text-right">BB</th>
                <th className="pb-2 text-right">SO</th>
                <th className="pb-2 text-right">SB</th>
                <th className="pb-2 text-right">AVG</th>
              </tr>
            </thead>
            <tbody>
              {hitting?.map((s) => {
                const p = s.players as unknown as { first_name: string; last_name: string; jersey_no: number; position: string };
                return (
                  <tr key={s.player_id} className="border-b border-gray-800/50 text-gray-300">
                    <td className="py-1.5">#{p?.jersey_no} {p?.first_name} {p?.last_name}</td>
                    <td className="py-1.5">{p?.position}</td>
                    <td className="py-1.5 text-right">{s.pa}</td>
                    <td className="py-1.5 text-right">{s.ab}</td>
                    <td className="py-1.5 text-right">{s.runs}</td>
                    <td className="py-1.5 text-right">{s.hits}</td>
                    <td className="py-1.5 text-right">{s.doubles}</td>
                    <td className="py-1.5 text-right">{s.triples}</td>
                    <td className="py-1.5 text-right">{s.hr}</td>
                    <td className="py-1.5 text-right">{s.rbi}</td>
                    <td className="py-1.5 text-right">{s.bb}</td>
                    <td className="py-1.5 text-right">{s.so}</td>
                    <td className="py-1.5 text-right">{s.sb}</td>
                    <td className="py-1.5 text-right font-mono">{ba(s.hits, s.ab)}</td>
                  </tr>
                );
              })}
              {(!hitting || hitting.length === 0) && (
                <tr><td colSpan={14} className="py-4 text-center text-gray-500">No hitting stats yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">Pitching</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-gray-400">
                <th className="pb-2">Player</th>
                <th className="pb-2 text-right">W</th>
                <th className="pb-2 text-right">L</th>
                <th className="pb-2 text-right">SV</th>
                <th className="pb-2 text-right">IP</th>
                <th className="pb-2 text-right">H</th>
                <th className="pb-2 text-right">R</th>
                <th className="pb-2 text-right">ER</th>
                <th className="pb-2 text-right">BB</th>
                <th className="pb-2 text-right">SO</th>
                <th className="pb-2 text-right">HR</th>
                <th className="pb-2 text-right">CG</th>
                <th className="pb-2 text-right">ERA</th>
              </tr>
            </thead>
            <tbody>
              {pitching?.map((s) => {
                const p = s.players as unknown as { first_name: string; last_name: string; jersey_no: number };
                return (
                  <tr key={s.player_id} className="border-b border-gray-800/50 text-gray-300">
                    <td className="py-1.5">#{p?.jersey_no} {p?.first_name} {p?.last_name}</td>
                    <td className="py-1.5 text-right">{s.w}</td>
                    <td className="py-1.5 text-right">{s.l}</td>
                    <td className="py-1.5 text-right">{s.sv}</td>
                    <td className="py-1.5 text-right">{ipStr(s.ip_outs)}</td>
                    <td className="py-1.5 text-right">{s.hits_allowed}</td>
                    <td className="py-1.5 text-right">{s.runs_allowed}</td>
                    <td className="py-1.5 text-right">{s.er}</td>
                    <td className="py-1.5 text-right">{s.bb_allowed}</td>
                    <td className="py-1.5 text-right">{s.so_pitched}</td>
                    <td className="py-1.5 text-right">{s.hr_allowed}</td>
                    <td className="py-1.5 text-right">{s.cg}</td>
                    <td className="py-1.5 text-right font-mono">{era(s.er, s.ip_outs)}</td>
                  </tr>
                );
              })}
              {(!pitching || pitching.length === 0) && (
                <tr><td colSpan={13} className="py-4 text-center text-gray-500">No pitching stats yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
