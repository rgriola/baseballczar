import { createClient } from '@/lib/supabase/server';
import { requireMyTeam } from '@/lib/queries/team';

export const revalidate = 60;

interface TeamTotals {
  teamId: number;
  teamName: string;
  // Hitting
  g: number; pa: number; ab: number; r: number; h: number;
  b2: number; b3: number; hr: number; rbi: number; bb: number;
  so: number; sb: number; cs: number;
  hPo: number; hA: number; hE: number;
  battedBalls: number; totalEv: number; totalLa: number;
  // Pitching
  pW: number; pL: number; pSv: number; pG: number; pGs: number;
  pIp: number; pH: number; pR: number; pEr: number; pBb: number;
  pSo: number; pHr: number; pitches: number; totalMph: number;
  pPo: number; pA: number; pE: number;
}

export default async function StandingsPage() {
  const team = await requireMyTeam();
  const supabase = await createClient();

  const { data: standings } = await supabase
    .from('standings')
    .select(`
      team_id, w, l,
      r, h, hr, ab, bb, so, rbi, b2, b3, era_runs, era_outs,
      p_ip, p_h, p_r, p_er, p_bb, p_so, p_hr,
      teams(team_name)
    `)
    .eq('league_id', team.league_id!)
    .order('w', { ascending: false });

  // Get team IDs
  const teamIds = (standings ?? []).map((s) => s.team_id);
  const teamNameMap = new Map(
    (standings ?? []).map((s) => [
      s.team_id,
      (s.teams as unknown as { team_name: string })?.team_name ?? '?',
    ]),
  );

  // Aggregate hitter season stats per team
  const { data: hitterRows } = await supabase
    .from('hitter_season_stats')
    .select('team_id, g, pa, ab, r, h, b2, b3, hr, rbi, bb, so, sb, cs, putouts, assists, errors, batted_balls, total_ev, total_la')
    .in('team_id', teamIds);

  // Aggregate pitcher season stats per team
  const { data: pitcherRows } = await supabase
    .from('pitcher_season_stats')
    .select('team_id, w, l, sv, g, gs, ip, h, r, er, bb, so, hr, pitches, total_mph, putouts, assists, errors')
    .in('team_id', teamIds);

  // Build per-team totals
  const totalsMap = new Map<number, TeamTotals>();
  for (const tid of teamIds) {
    totalsMap.set(tid, {
      teamId: tid,
      teamName: teamNameMap.get(tid) ?? '?',
      g: 0, pa: 0, ab: 0, r: 0, h: 0, b2: 0, b3: 0, hr: 0, rbi: 0,
      bb: 0, so: 0, sb: 0, cs: 0, hPo: 0, hA: 0, hE: 0,
      battedBalls: 0, totalEv: 0, totalLa: 0,
      pW: 0, pL: 0, pSv: 0, pG: 0, pGs: 0,
      pIp: 0, pH: 0, pR: 0, pEr: 0, pBb: 0, pSo: 0, pHr: 0,
      pitches: 0, totalMph: 0, pPo: 0, pA: 0, pE: 0,
    });
  }

  for (const row of hitterRows ?? []) {
    const t = totalsMap.get(row.team_id);
    if (!t) continue;
    t.g = Math.max(t.g, row.g); // g is per-player; we'll use standings w+l below
    t.pa += row.pa; t.ab += row.ab; t.r += row.r; t.h += row.h;
    t.b2 += row.b2; t.b3 += row.b3; t.hr += row.hr; t.rbi += row.rbi;
    t.bb += row.bb; t.so += row.so; t.sb += row.sb; t.cs += row.cs;
    t.hPo += row.putouts; t.hA += row.assists; t.hE += row.errors;
    t.battedBalls += row.batted_balls; t.totalEv += row.total_ev; t.totalLa += row.total_la;
  }

  for (const row of pitcherRows ?? []) {
    const t = totalsMap.get(row.team_id);
    if (!t) continue;
    t.pW += row.w; t.pL += row.l; t.pSv += row.sv;
    t.pG += row.g; t.pGs += row.gs;
    t.pIp += row.ip; t.pH += row.h; t.pR += row.r; t.pEr += row.er;
    t.pBb += row.bb; t.pSo += row.so; t.pHr += row.hr;
    t.pitches += row.pitches; t.totalMph += row.total_mph;
    t.pPo += row.putouts; t.pA += row.assists; t.pE += row.errors;
  }

  // ── Helpers ──
  function pct(w: number, l: number) {
    return w + l > 0 ? (w / (w + l)).toFixed(3).replace(/^0/, '') : '.000';
  }
  function teamEra(er: number, outs: number) {
    const ip = outs / 3;
    return ip > 0 ? ((er / ip) * 9).toFixed(2) : '0.00';
  }
  function ipToInnings(ip: number): number {
    const whole = Math.floor(ip);
    const frac = Math.round((ip - whole) * 10);
    return whole + frac / 3;
  }
  function fmtWhip(h: number, bb: number, ip: number) {
    const inn = ipToInnings(ip);
    return inn > 0 ? ((h + bb) / inn).toFixed(2) : '0.00';
  }
  function fmtAvg(h: number, ab: number) {
    return ab > 0 ? (h / ab).toFixed(3).replace(/^0/, '') : '.000';
  }
  function fmtObp(h: number, bb: number, ab: number) {
    const denom = ab + bb;
    return denom > 0 ? ((h + bb) / denom).toFixed(3).replace(/^0/, '') : '.000';
  }
  function fmtSlg(h: number, b2: number, b3: number, hr: number, ab: number) {
    if (ab === 0) return '.000';
    const singles = h - b2 - b3 - hr;
    return ((singles + b2 * 2 + b3 * 3 + hr * 4) / ab).toFixed(3).replace(/^0/, '');
  }
  function gb(topW: number, topL: number, w: number, l: number) {
    const diff = ((topW - w) + (l - topL)) / 2;
    return diff === 0 ? '—' : diff.toFixed(1);
  }

  const topW = standings?.[0]?.w ?? 0;
  const topL = standings?.[0]?.l ?? 0;

  // Load O2O records for all teams in the league
  const { data: o2oRecords } = await supabase
    .from('o2o_records')
    .select('team_a_id, team_b_id, wins_a, wins_b')
    .or(
      teamIds.map((id) => `team_a_id.eq.${id},team_b_id.eq.${id}`).join(','),
    );

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
    <div className="space-y-8">
      <h1 className="text-2xl font-bold text-white">League Standings</h1>

      {/* ── Standings Table ── */}
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
              <th className="pb-2 text-right">AVG</th>
              <th className="pb-2 text-right">HR</th>
              <th className="pb-2 text-right text-amber-400" title="Runs Allowed">RA</th>
              <th className="pb-2 text-right text-amber-400">ERA</th>
              <th className="pb-2 text-right text-amber-400">WHIP</th>
              <th className="pb-2 text-right text-amber-400" title="Team Strikeouts">K</th>
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
                  <td className="py-1.5 text-right font-mono">{fmtAvg(s.h, s.ab)}</td>
                  <td className="py-1.5 text-right">{s.hr}</td>
                  <td className="py-1.5 text-right text-amber-400">{s.p_r ?? 0}</td>
                  <td className="py-1.5 text-right font-mono text-amber-400">{teamEra(s.era_runs ?? 0, s.era_outs ?? 0)}</td>
                  <td className="py-1.5 text-right font-mono text-amber-400">{fmtWhip(s.p_h ?? 0, s.p_bb ?? 0, s.p_ip ?? 0)}</td>
                  <td className="py-1.5 text-right text-amber-400">{s.p_so ?? 0}</td>
                  <td className="py-1.5 text-right text-xs">{o2oMap[s.team_id] ? `${o2oMap[s.team_id].w}-${o2oMap[s.team_id].l}` : '0-0'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Team Hitting Totals ── */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-3 pt-4">Team Hitting</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-gray-400">
                <th className="pb-2 sticky left-0 bg-gray-950 z-10">Team</th>
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
                <th className="pb-2 text-right text-emerald-400" title="Avg Exit Velocity">EV</th>
                <th className="pb-2 text-right text-emerald-400" title="Avg Launch Angle">LA</th>
              </tr>
            </thead>
            <tbody>
              {(standings ?? []).map((s) => {
                const t = totalsMap.get(s.team_id);
                if (!t) return null;
                const isMe = s.team_id === team.id;
                return (
                  <tr key={s.team_id} className={`border-b border-gray-800/50 ${isMe ? 'text-blue-400 font-semibold' : 'text-gray-300'}`}>
                    <td className="py-1.5 sticky left-0 bg-gray-950 z-10">{t.teamName}</td>
                    <td className="py-1.5 text-right">{s.w + s.l}</td>
                    <td className="py-1.5 text-right">{t.pa}</td>
                    <td className="py-1.5 text-right">{t.ab}</td>
                    <td className="py-1.5 text-right">{t.r}</td>
                    <td className="py-1.5 text-right">{t.h}</td>
                    <td className="py-1.5 text-right">{t.b2}</td>
                    <td className="py-1.5 text-right">{t.b3}</td>
                    <td className="py-1.5 text-right">{t.hr}</td>
                    <td className="py-1.5 text-right">{t.rbi}</td>
                    <td className="py-1.5 text-right">{t.bb}</td>
                    <td className="py-1.5 text-right">{t.so}</td>
                    <td className="py-1.5 text-right">{t.sb}</td>
                    <td className="py-1.5 text-right">{t.cs}</td>
                    <td className="py-1.5 text-right font-mono">{fmtAvg(t.h, t.ab)}</td>
                    <td className="py-1.5 text-right font-mono">{fmtObp(t.h, t.bb, t.ab)}</td>
                    <td className="py-1.5 text-right font-mono">{fmtSlg(t.h, t.b2, t.b3, t.hr, t.ab)}</td>
                    <td className="py-1.5 text-right font-mono text-emerald-400">{t.battedBalls > 0 ? (t.totalEv / t.battedBalls).toFixed(1) : '—'}</td>
                    <td className="py-1.5 text-right font-mono text-emerald-400">{t.battedBalls > 0 ? (t.totalLa / t.battedBalls).toFixed(1) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Team Pitching Totals ── */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-3">Team Pitching</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-gray-400">
                <th className="pb-2 sticky left-0 bg-gray-950 z-10">Team</th>
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
                <th className="pb-2 text-right">ERA</th>
                <th className="pb-2 text-right">WHIP</th>
                <th className="pb-2 text-right text-emerald-400" title="Avg Pitch Velocity">MPH</th>
                <th className="pb-2 text-right text-emerald-400">PC</th>
              </tr>
            </thead>
            <tbody>
              {(standings ?? []).map((s) => {
                const t = totalsMap.get(s.team_id);
                if (!t) return null;
                const isMe = s.team_id === team.id;
                return (
                  <tr key={s.team_id} className={`border-b border-gray-800/50 ${isMe ? 'text-blue-400 font-semibold' : 'text-gray-300'}`}>
                    <td className="py-1.5 sticky left-0 bg-gray-950 z-10">{t.teamName}</td>
                    <td className="py-1.5 text-right">{t.pW}</td>
                    <td className="py-1.5 text-right">{t.pL}</td>
                    <td className="py-1.5 text-right">{t.pSv}</td>
                    <td className="py-1.5 text-right">{t.pIp.toFixed(1)}</td>
                    <td className="py-1.5 text-right">{t.pH}</td>
                    <td className="py-1.5 text-right">{t.pR}</td>
                    <td className="py-1.5 text-right">{t.pEr}</td>
                    <td className="py-1.5 text-right">{t.pBb}</td>
                    <td className="py-1.5 text-right">{t.pSo}</td>
                    <td className="py-1.5 text-right">{t.pHr}</td>
                    <td className="py-1.5 text-right font-mono">{teamEra(s.era_runs ?? 0, s.era_outs ?? 0)}</td>
                    <td className="py-1.5 text-right font-mono">{fmtWhip(t.pH, t.pBb, t.pIp)}</td>
                    <td className="py-1.5 text-right font-mono text-emerald-400">{t.pitches > 0 ? (t.totalMph / t.pitches).toFixed(1) : '—'}</td>
                    <td className="py-1.5 text-right text-emerald-400">{t.pitches}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* ── Team Fielding Totals ── */}
      <section>
        <h2 className="text-lg font-semibold text-white mb-3">Team Fielding</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-gray-400">
                <th className="pb-2 sticky left-0 bg-gray-950 z-10">Team</th>
                <th className="pb-2 text-right">PO</th>
                <th className="pb-2 text-right">A</th>
                <th className="pb-2 text-right">E</th>
                <th className="pb-2 text-right">Fld %</th>
                <th className="pb-2 text-right text-blue-400" title="Hitter Putouts">H-PO</th>
                <th className="pb-2 text-right text-blue-400" title="Hitter Assists">H-A</th>
                <th className="pb-2 text-right text-blue-400" title="Hitter Errors">H-E</th>
                <th className="pb-2 text-right text-amber-400" title="Pitcher Putouts">P-PO</th>
                <th className="pb-2 text-right text-amber-400" title="Pitcher Assists">P-A</th>
                <th className="pb-2 text-right text-amber-400" title="Pitcher Errors">P-E</th>
              </tr>
            </thead>
            <tbody>
              {(standings ?? []).map((s) => {
                const t = totalsMap.get(s.team_id);
                if (!t) return null;
                const isMe = s.team_id === team.id;
                const po = t.hPo + t.pPo;
                const a = t.hA + t.pA;
                const e = t.hE + t.pE;
                const chances = po + a + e;
                return (
                  <tr key={s.team_id} className={`border-b border-gray-800/50 ${isMe ? 'text-blue-400 font-semibold' : 'text-gray-300'}`}>
                    <td className="py-1.5 sticky left-0 bg-gray-950 z-10">{t.teamName}</td>
                    <td className="py-1.5 text-right">{po}</td>
                    <td className="py-1.5 text-right">{a}</td>
                    <td className="py-1.5 text-right">{e}</td>
                    <td className="py-1.5 text-right font-mono">{chances > 0 ? ((po + a) / chances * 100).toFixed(1) + '%' : '—'}</td>
                    <td className="py-1.5 text-right text-blue-400">{t.hPo}</td>
                    <td className="py-1.5 text-right text-blue-400">{t.hA}</td>
                    <td className="py-1.5 text-right text-blue-400">{t.hE}</td>
                    <td className="py-1.5 text-right text-amber-400">{t.pPo}</td>
                    <td className="py-1.5 text-right text-amber-400">{t.pA}</td>
                    <td className="py-1.5 text-right text-amber-400">{t.pE}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
