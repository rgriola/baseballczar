import { createClient } from '@/lib/supabase/server';
import { requireMyTeam } from '@/lib/queries/team';

export const revalidate = 60;

export default async function StatsPage() {
  const team = await requireMyTeam();
  const supabase = await createClient();

  const { data: hitting } = await supabase
    .from('player_stats_hitting')
    .select('player_id, ab, r, h, b2, b3, hr, rbi, bb, so, sb, cs, sf, sac, players(first_name, last_name, jersey_no, position)')
    .eq('team_id', team.id)
    .order('ab', { ascending: false });

  const { data: pitching } = await supabase
    .from('player_stats_pitching')
    .select('player_id, w, l, sv, ip, h, r, er, bb, so, hr, bf, cg, sho, players(first_name, last_name, jersey_no)')
    .eq('team_id', team.id)
    .order('ip', { ascending: false });

  function ba(h: number, ab: number) {
    return ab > 0 ? (h / ab).toFixed(3) : '.000';
  }
  function pa(ab: number, bb: number, sf: number, sac: number) {
    return ab + bb + sf + sac;
  }
  // ip is stored as e.g. 6.2 meaning 6 innings + 2 outs
  function ipToInnings(ip: number): number {
    const whole = Math.floor(ip);
    const frac = Math.round((ip - whole) * 10);
    return whole + frac / 3;
  }
  function era(er: number, ip: number) {
    const inn = ipToInnings(ip);
    return inn > 0 ? ((er / inn) * 9).toFixed(2) : '0.00';
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
                    <td className="py-1.5 text-right">{pa(s.ab, s.bb, s.sf, s.sac)}</td>
                    <td className="py-1.5 text-right">{s.ab}</td>
                    <td className="py-1.5 text-right">{s.r}</td>
                    <td className="py-1.5 text-right">{s.h}</td>
                    <td className="py-1.5 text-right">{s.b2}</td>
                    <td className="py-1.5 text-right">{s.b3}</td>
                    <td className="py-1.5 text-right">{s.hr}</td>
                    <td className="py-1.5 text-right">{s.rbi}</td>
                    <td className="py-1.5 text-right">{s.bb}</td>
                    <td className="py-1.5 text-right">{s.so}</td>
                    <td className="py-1.5 text-right">{s.sb}</td>
                    <td className="py-1.5 text-right font-mono">{ba(s.h, s.ab)}</td>
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
                    <td className="py-1.5 text-right">{s.ip}</td>
                    <td className="py-1.5 text-right">{s.h}</td>
                    <td className="py-1.5 text-right">{s.r}</td>
                    <td className="py-1.5 text-right">{s.er}</td>
                    <td className="py-1.5 text-right">{s.bb}</td>
                    <td className="py-1.5 text-right">{s.so}</td>
                    <td className="py-1.5 text-right">{s.hr}</td>
                    <td className="py-1.5 text-right">{s.cg}</td>
                    <td className="py-1.5 text-right font-mono">{era(s.er, s.ip)}</td>
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
