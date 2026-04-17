/* eslint-disable @typescript-eslint/no-explicit-any */

interface Props {
  label: string;
  hitting: any[];
  pitching: any[];
}

function ba(h: number, ab: number) {
  return ab > 0 ? (h / ab).toFixed(3) : '.000';
}

function ipStr(ip: number) {
  // ip is stored as real (e.g. 6.333 for 6.1)
  const full = Math.floor(ip);
  const frac = Math.round((ip - full) * 10);
  return `${full}.${frac}`;
}

export default function BoxScore({ label, hitting, pitching }: Props) {
  return (
    <section className="space-y-4">
      <h2 className="text-lg font-semibold text-white">{label}</h2>

      {/* Hitting */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800 text-gray-400">
              <th className="pb-1 text-left">Batter</th>
              <th className="pb-1 text-right">AB</th>
              <th className="pb-1 text-right">R</th>
              <th className="pb-1 text-right">H</th>
              <th className="pb-1 text-right">2B</th>
              <th className="pb-1 text-right">3B</th>
              <th className="pb-1 text-right">HR</th>
              <th className="pb-1 text-right">RBI</th>
              <th className="pb-1 text-right">BB</th>
              <th className="pb-1 text-right">SO</th>
              <th className="pb-1 text-right">AVG</th>
            </tr>
          </thead>
          <tbody>
            {hitting.map((h) => {
              const p = h.players as { first_name: string; last_name: string; jersey_no: number; position: string } | null;
              return (
                <tr key={h.id} className="border-b border-gray-800/30 text-gray-300">
                  <td className="py-0.5">
                    {p ? `${p.first_name[0]}. ${p.last_name}` : '?'}{' '}
                    <span className="text-gray-500">{h.position ?? p?.position}</span>
                  </td>
                  <td className="py-0.5 text-right">{h.ab}</td>
                  <td className="py-0.5 text-right">{h.r}</td>
                  <td className="py-0.5 text-right">{h.h}</td>
                  <td className="py-0.5 text-right">{h.b2}</td>
                  <td className="py-0.5 text-right">{h.b3}</td>
                  <td className="py-0.5 text-right">{h.hr}</td>
                  <td className="py-0.5 text-right">{h.rbi}</td>
                  <td className="py-0.5 text-right">{h.bb}</td>
                  <td className="py-0.5 text-right">{h.so}</td>
                  <td className="py-0.5 text-right font-mono">{ba(h.h, h.ab)}</td>
                </tr>
              );
            })}
            {hitting.length === 0 && (
              <tr><td colSpan={11} className="py-2 text-center text-gray-600">No data</td></tr>
            )}
            {/* Totals */}
            {hitting.length > 0 && (
              <tr className="border-t border-gray-700 font-semibold text-gray-200">
                <td className="py-0.5">Totals</td>
                <td className="py-0.5 text-right">{hitting.reduce((s: number, h: any) => s + h.ab, 0)}</td>
                <td className="py-0.5 text-right">{hitting.reduce((s: number, h: any) => s + h.r, 0)}</td>
                <td className="py-0.5 text-right">{hitting.reduce((s: number, h: any) => s + h.h, 0)}</td>
                <td className="py-0.5 text-right">{hitting.reduce((s: number, h: any) => s + h.b2, 0)}</td>
                <td className="py-0.5 text-right">{hitting.reduce((s: number, h: any) => s + h.b3, 0)}</td>
                <td className="py-0.5 text-right">{hitting.reduce((s: number, h: any) => s + h.hr, 0)}</td>
                <td className="py-0.5 text-right">{hitting.reduce((s: number, h: any) => s + h.rbi, 0)}</td>
                <td className="py-0.5 text-right">{hitting.reduce((s: number, h: any) => s + h.bb, 0)}</td>
                <td className="py-0.5 text-right">{hitting.reduce((s: number, h: any) => s + h.so, 0)}</td>
                <td className="py-0.5 text-right"></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Pitching */}
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="border-b border-gray-800 text-gray-400">
              <th className="pb-1 text-left">Pitcher</th>
              <th className="pb-1 text-right">IP</th>
              <th className="pb-1 text-right">H</th>
              <th className="pb-1 text-right">R</th>
              <th className="pb-1 text-right">ER</th>
              <th className="pb-1 text-right">BB</th>
              <th className="pb-1 text-right">SO</th>
              <th className="pb-1 text-right">HR</th>
              <th className="pb-1 text-center">Dec</th>
            </tr>
          </thead>
          <tbody>
            {pitching.map((p) => {
              const pl = p.players as { first_name: string; last_name: string; jersey_no: number } | null;
              let dec = '';
              if (p.w) dec = 'W';
              else if (p.l) dec = 'L';
              else if (p.sv) dec = 'SV';
              return (
                <tr key={p.id} className="border-b border-gray-800/30 text-gray-300">
                  <td className="py-0.5">
                    {pl ? `${pl.first_name[0]}. ${pl.last_name}` : '?'}
                  </td>
                  <td className="py-0.5 text-right">{ipStr(p.ip)}</td>
                  <td className="py-0.5 text-right">{p.h}</td>
                  <td className="py-0.5 text-right">{p.r}</td>
                  <td className="py-0.5 text-right">{p.er}</td>
                  <td className="py-0.5 text-right">{p.bb}</td>
                  <td className="py-0.5 text-right">{p.so}</td>
                  <td className="py-0.5 text-right">{p.hr}</td>
                  <td className="py-0.5 text-center">
                    {dec && (
                      <span className={`rounded px-1 py-0.5 text-[10px] font-bold ${
                        dec === 'W' ? 'bg-green-900/50 text-green-400' :
                        dec === 'L' ? 'bg-red-900/50 text-red-400' :
                        'bg-blue-900/50 text-blue-400'
                      }`}>
                        {dec}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
            {pitching.length === 0 && (
              <tr><td colSpan={9} className="py-2 text-center text-gray-600">No data</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
