'use client';

import { useState, useTransition } from 'react';
import { updateLineup } from '../actions';

interface Hitter {
  id: number;
  first_name: string;
  last_name: string;
  jersey_no: number;
  position: string;
  batt_order: number;
  speed: number;
  ag: number;
  eye: number;
  avg: number;
  strength: number;
  dhr: number;
}

export default function LineupEditor({ hitters }: { hitters: Hitter[] }) {
  const [lineup, setLineup] = useState<Hitter[]>(
    hitters.filter((h) => h.batt_order >= 1 && h.batt_order <= 9).sort((a, b) => a.batt_order - b.batt_order),
  );
  const [bench, setBench] = useState<Hitter[]>(
    hitters.filter((h) => h.batt_order === 0 || h.batt_order > 9),
  );
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function handleDragStart(idx: number) {
    setDragIdx(idx);
  }

  function handleDrop(targetIdx: number) {
    if (dragIdx === null || dragIdx === targetIdx) return;
    const next = [...lineup];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(targetIdx, 0, moved);
    setLineup(next);
    setDragIdx(null);
  }

  function swapIn(benchPlayer: Hitter, lineupIdx: number) {
    const next = [...lineup];
    const removed = next[lineupIdx];
    next[lineupIdx] = benchPlayer;
    setLineup(next);
    setBench([...bench.filter((b) => b.id !== benchPlayer.id), removed]);
  }

  function save() {
    if (lineup.length !== 9) {
      setMessage('Lineup must have exactly 9 players');
      return;
    }
    const fd = new FormData();
    fd.set('playerIds', JSON.stringify(lineup.map((p) => p.id)));
    startTransition(async () => {
      const result = await updateLineup(fd);
      setMessage(result?.error ?? 'Lineup saved!');
    });
  }

  return (
    <div className="grid gap-8 lg:grid-cols-2">
      <div>
        <h2 className="mb-3 text-lg font-semibold text-white">Starting Lineup</h2>
        <div className="space-y-1">
          {lineup.map((p, i) => (
            <div
              key={p.id}
              draggable
              onDragStart={() => handleDragStart(i)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={() => handleDrop(i)}
              className={`flex cursor-grab items-center justify-between rounded px-4 py-2 text-sm ${
                dragIdx === i ? 'bg-blue-900/50' : 'bg-gray-900'
              }`}
            >
              <div className="flex items-center gap-3">
                <span className="w-6 text-center text-gray-500">{i + 1}</span>
                <span className="text-white">#{p.jersey_no} {p.first_name} {p.last_name}</span>
                <span className="text-gray-500">{p.position}</span>
              </div>
              <div className="flex gap-3 text-xs text-gray-400">
                <span>SPD:{p.speed}</span>
                <span>EYE:{p.eye}</span>
                <span>AVG:{p.avg}</span>
                <span>STR:{p.strength}</span>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={save}
          disabled={isPending || lineup.length !== 9}
          className="mt-4 rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {isPending ? 'Saving...' : 'Save Lineup'}
        </button>

        {message && (
          <p className={`mt-2 text-sm ${message.includes('saved') ? 'text-green-400' : 'text-red-400'}`}>
            {message}
          </p>
        )}
      </div>

      <div>
        <h2 className="mb-3 text-lg font-semibold text-white">Bench</h2>
        <div className="space-y-1">
          {bench.map((p) => (
            <div key={p.id} className="flex items-center justify-between rounded bg-gray-900/60 px-4 py-2 text-sm">
              <div className="flex items-center gap-3">
                <span className="text-gray-300">#{p.jersey_no} {p.first_name} {p.last_name}</span>
                <span className="text-gray-500">{p.position}</span>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-500">
                  SPD:{p.speed} EYE:{p.eye} AVG:{p.avg} STR:{p.strength}
                </span>
                {lineup.length === 9 && (
                  <select
                    onChange={(e) => {
                      const idx = parseInt(e.target.value, 10);
                      if (!isNaN(idx)) swapIn(p, idx);
                      e.target.value = '';
                    }}
                    defaultValue=""
                    className="rounded bg-gray-800 px-2 py-1 text-xs text-gray-300"
                  >
                    <option value="" disabled>Swap for…</option>
                    {lineup.map((l, i) => (
                      <option key={l.id} value={i}>
                        {i + 1}. {l.last_name}
                      </option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
