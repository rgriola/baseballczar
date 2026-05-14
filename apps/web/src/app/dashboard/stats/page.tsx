import { createClient } from '@/lib/supabase/server';
import { requireMyTeam } from '@/lib/queries/team';

export const revalidate = 60;

export default async function StatsPage() {
  const team = await requireMyTeam();
  const supabase = await createClient();

  const { data: hitting } = await supabase
    .from('hitter_season_stats')
    .select('player_id, g, pa, ab, r, h, b2, b3, hr, rbi, bb, so, sb, cs, sf, sac, putouts, assists, errors, batted_balls, total_ev, total_la, total_spray, total_bat_speed, players(first_name, last_name, jersey_no, position)')
    .eq('team_id', team.id)
    .order('ab', { ascending: false });

  const { data: pitching } = await supabase
    .from('pitcher_season_stats')
    .select('player_id, w, l, sv, g, gs, ip, h, r, er, bb, so, hr, bf, cg, sho, pitches, total_mph, putouts, assists, errors, players(first_name, last_name, jersey_no)')
    .eq('team_id', team.id)
    .order('ip', { ascending: false });

  function ba(h: number, ab: number) {
    return ab > 0 ? (h / ab).toFixed(3).replace(/^0/, '') : '.000';
  }
  function obp(h: number, bb: number, ab: number, sf: number) {
    const denom = ab + bb + sf;
    return denom > 0 ? ((h + bb) / denom).toFixed(3).replace(/^0/, '') : '.000';
  }
  function slg(h: number, b2: number, b3: number, hr: number, ab: number) {
    if (ab === 0) return '.000';
    const singles = h - b2 - b3 - hr;
    return ((singles + b2 * 2 + b3 * 3 + hr * 4) / ab).toFixed(3).replace(/^0/, '');
  }
  function avgEv(totalEv: number, bb: number) {
    return bb > 0 ? (totalEv / bb).toFixed(1) : '—';
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
  function whip(h: number, bb: number, ip: number) {
    const inn = ipToInnings(ip);
    return inn > 0 ? ((h + bb) / inn).toFixed(2) : '0.00';
  }
  function avgMph(totalMph: number, pitches: number) {
    return pitches > 0 ? (totalMph / pitches).toFixed(1) : '—';
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
                <th className="pb-2 sticky left-0 bg-gray-950 z-10">Player</th>
                <th className="pb-2">Pos</th>
                <th className="pb-2 text-right">G</th>
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
                <th className="pb-2 text-right">CS</th>
                <th className="pb-2 text-right">AVG</th>
                <th className="pb-2 text-right">OBP</th>
                <th className="pb-2 text-right">SLG</th>
                <th className="pb-2 text-right text-blue-400" title="Putouts">PO</th>
                <th className="pb-2 text-right text-blue-400" title="Assists">A</th>
                <th className="pb-2 text-right text-blue-400" title="Errors">E</th>
                <th className="pb-2 text-right text-emerald-400" title="Avg Exit Velocity">EV</th>
                <th className="pb-2 text-right text-emerald-400" title="Avg Launch Angle">LA</th>
              </tr>
            </thead>
            <tbody>
              {hitting?.map((s) => {
                const p = s.players as unknown as { first_name: string; last_name: string; jersey_no: number; position: string };
                return (
                  <tr key={s.player_id} className="border-b border-gray-800/50 text-gray-300">
                    <td className="py-1.5 sticky left-0 bg-gray-950 z-10">#{p?.jersey_no} {p?.first_name} {p?.last_name}</td>
                    <td className="py-1.5">{p?.position}</td>
                    <td className="py-1.5 text-right">{s.g}</td>
                    <td className="py-1.5 text-right">{s.pa}</td>
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
                    <td className="py-1.5 text-right">{s.cs}</td>
                    <td className="py-1.5 text-right font-mono">{ba(s.h, s.ab)}</td>
                    <td className="py-1.5 text-right font-mono">{obp(s.h, s.bb, s.ab, s.sf)}</td>
                    <td className="py-1.5 text-right font-mono">{slg(s.h, s.b2, s.b3, s.hr, s.ab)}</td>
                    <td className="py-1.5 text-right text-blue-400">{s.putouts}</td>
                    <td className="py-1.5 text-right text-blue-400">{s.assists}</td>
                    <td className="py-1.5 text-right text-blue-400">{s.errors}</td>
                    <td className="py-1.5 text-right text-emerald-400 font-mono">{avgEv(s.total_ev, s.batted_balls)}</td>
                    <td className="py-1.5 text-right text-emerald-400 font-mono">{s.batted_balls > 0 ? (s.total_la / s.batted_balls).toFixed(1) : '—'}</td>
                  </tr>
                );
              })}
              {(!hitting || hitting.length === 0) && (
                <tr><td colSpan={23} className="py-4 text-center text-gray-500">No hitting stats yet</td></tr>
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
                <th className="pb-2 sticky left-0 bg-gray-950 z-10">Player</th>
                <th className="pb-2 text-right">W</th>
                <th className="pb-2 text-right">L</th>
                <th className="pb-2 text-right">SV</th>
                <th className="pb-2 text-right">G</th>
                <th className="pb-2 text-right">GS</th>
                <th className="pb-2 text-right">IP</th>
                <th className="pb-2 text-right">H</th>
                <th className="pb-2 text-right">R</th>
                <th className="pb-2 text-right">ER</th>
                <th className="pb-2 text-right">BB</th>
                <th className="pb-2 text-right">SO</th>
                <th className="pb-2 text-right">HR</th>
                <th className="pb-2 text-right">ERA</th>
                <th className="pb-2 text-right">WHIP</th>
                <th className="pb-2 text-right text-emerald-400" title="Avg Pitch Velocity">MPH</th>
                <th className="pb-2 text-right text-blue-400" title="Pitches">PC</th>
                <th className="pb-2 text-right text-blue-400" title="Putouts">PO</th>
                <th className="pb-2 text-right text-blue-400" title="Assists">A</th>
                <th className="pb-2 text-right text-blue-400" title="Errors">E</th>
              </tr>
            </thead>
            <tbody>
              {pitching?.map((s) => {
                const p = s.players as unknown as { first_name: string; last_name: string; jersey_no: number };
                return (
                  <tr key={s.player_id} className="border-b border-gray-800/50 text-gray-300">
                    <td className="py-1.5 sticky left-0 bg-gray-950 z-10">#{p?.jersey_no} {p?.first_name} {p?.last_name}</td>
                    <td className="py-1.5 text-right">{s.w}</td>
                    <td className="py-1.5 text-right">{s.l}</td>
                    <td className="py-1.5 text-right">{s.sv}</td>
                    <td className="py-1.5 text-right">{s.g}</td>
                    <td className="py-1.5 text-right">{s.gs}</td>
                    <td className="py-1.5 text-right">{s.ip}</td>
                    <td className="py-1.5 text-right">{s.h}</td>
                    <td className="py-1.5 text-right">{s.r}</td>
                    <td className="py-1.5 text-right">{s.er}</td>
                    <td className="py-1.5 text-right">{s.bb}</td>
                    <td className="py-1.5 text-right">{s.so}</td>
                    <td className="py-1.5 text-right">{s.hr}</td>
                    <td className="py-1.5 text-right font-mono">{era(s.er, s.ip)}</td>
                    <td className="py-1.5 text-right font-mono">{whip(s.h, s.bb, s.ip)}</td>
                    <td className="py-1.5 text-right text-emerald-400 font-mono">{avgMph(s.total_mph, s.pitches)}</td>
                    <td className="py-1.5 text-right text-blue-400">{s.pitches}</td>
                    <td className="py-1.5 text-right text-blue-400">{s.putouts}</td>
                    <td className="py-1.5 text-right text-blue-400">{s.assists}</td>
                    <td className="py-1.5 text-right text-blue-400">{s.errors}</td>
                  </tr>
                );
              })}
              {(!pitching || pitching.length === 0) && (
                <tr><td colSpan={20} className="py-4 text-center text-gray-500">No pitching stats yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
