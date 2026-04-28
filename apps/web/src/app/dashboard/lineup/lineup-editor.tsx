'use client';

import { useState, useTransition } from 'react';
import { updateLineup } from '../actions';
import { CountryFlag } from '../roster/country-flag';

const HAND_LABEL: Record<number, string> = { 1: 'R', 2: 'L', 3: 'S' };

const LINEUP_POSITIONS = ['C', '1B', '2B', '3B', 'SS', 'LF', 'CF', 'RF', 'DH'] as const;
const VALID_LINEUP_SET = new Set<string>(LINEUP_POSITIONS);

/** Map a stored DB position to a valid lineup position; bench codes (B1–B6, UTIL, etc.) default to DH */
function toLineupPosition(pos: string): string {
  return VALID_LINEUP_SET.has(pos) ? pos : 'DH';
}

interface Hitter {
  id: number;
  first_name: string;
  last_name: string;
  jersey_no: number;
  position: string;
  batt_order: number;
  age: number;
  height: number;
  weight: number;
  hand_batting: number;
  hand_throw: number;
  speed: number;
  stamina: number;
  ag: number;
  eye: number;
  avg: number;
  strength: number;
  play_intel: number;
  bunting: number;
  fielding: number;
  throw: number;
  country_id: number;
}

function totalSkill(p: Hitter) {
  return +(p.speed + p.stamina + p.ag + p.eye + p.avg + p.strength + p.play_intel + p.bunting + p.fielding + p.throw).toFixed(1);
}

export default function LineupEditor({ hitters }: { hitters: Hitter[] }) {
  // Auto-fill lineup to 9 if fewer than 9 starters exist
  const initialLineup = hitters
    .filter((h) => h.batt_order >= 1 && h.batt_order <= 9)
    .sort((a, b) => a.batt_order - b.batt_order);
  const initialBench = hitters.filter((h) => h.batt_order === 0 || h.batt_order > 9);

  // If lineup is short, promote bench players to fill
  while (initialLineup.length < 9 && initialBench.length > 0) {
    initialLineup.push(initialBench.shift()!);
  }

  const [lineup, setLineup] = useState<Hitter[]>(initialLineup);
  const [bench, setBench] = useState<Hitter[]>(initialBench);
  // Track assigned lineup positions per player (bench codes like B1–B6/UTIL map to DH)
  const [positions, setPositions] = useState<Record<number, string>>(() => {
    const map: Record<number, string> = {};
    for (const p of initialLineup) map[p.id] = toLineupPosition(p.position);
    return map;
  });
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

  function changePosition(playerId: number, newPos: string) {
    setPositions((prev) => ({ ...prev, [playerId]: newPos }));
  }

  function swapPositions(idxA: number, idxB: number) {
    const a = lineup[idxA];
    const b = lineup[idxB];
    if (!a || !b) return;
    setPositions((prev) => ({
      ...prev,
      [a.id]: prev[b.id] ?? toLineupPosition(b.position),
      [b.id]: prev[a.id] ?? toLineupPosition(a.position),
    }));
  }

  function swapIn(benchPlayer: Hitter, lineupIdx: number) {
    const next = [...lineup];
    const removed = next[lineupIdx];
    next[lineupIdx] = benchPlayer;
    setLineup(next);
    setBench([...bench.filter((b) => b.id !== benchPlayer.id), removed]);
    // New player inherits removed player's lineup position; removed loses theirs
    setPositions((prev) => {
      const updated = { ...prev };
      updated[benchPlayer.id] = prev[removed.id] ?? toLineupPosition(removed.position);
      delete updated[removed.id];
      return updated;
    });
  }

  function save() {
    if (lineup.length !== 9) {
      setMessage('Lineup must have exactly 9 players');
      return;
    }
    const fd = new FormData();
    fd.set('playerIds', JSON.stringify(lineup.map((p) => p.id)));
    fd.set('positions', JSON.stringify(lineup.map((p) => positions[p.id] ?? toLineupPosition(p.position))));
    fd.set('benchIds', JSON.stringify(bench.map((p) => p.id)));
    startTransition(async () => {
      const result = await updateLineup(fd);
      setMessage(result?.error ?? 'Lineup saved!');
    });
  }

  const skillHeaders = (
    <tr className="border-b border-gray-800 text-left text-gray-400">
      <th className="pb-2 w-8"></th>
      <th className="pb-2">#</th>
      <th className="pb-2">Name</th>
      <th className="pb-2">Pos</th>
      <th className="pb-2 text-right">Age</th>
      <th className="pb-2 text-right">Ht</th>
      <th className="pb-2 text-right">Wt</th>
      <th className="pb-2 text-right">B/T</th>
      <th className="pb-2 text-right">SPD</th>
      <th className="pb-2 text-right">STA</th>
      <th className="pb-2 text-right">AG</th>
      <th className="pb-2 text-right">EYE</th>
      <th className="pb-2 text-right">AVG</th>
      <th className="pb-2 text-right">STR</th>
      <th className="pb-2 text-right">PI</th>
      <th className="pb-2 text-right">BNT</th>
      <th className="pb-2 text-right">FLD</th>
      <th className="pb-2 text-right">THR</th>
      <th className="pb-2 text-right font-semibold">TOT</th>
    </tr>
  );

  function playerCells(p: Hitter, posContent: React.ReactNode, extra?: React.ReactNode) {
    return (
      <>
        <td className="py-1.5">{p.jersey_no}</td>
        <td className="py-1.5 font-medium whitespace-nowrap"><CountryFlag countryId={p.country_id} /> {p.first_name} {p.last_name}</td>
        <td className="py-1.5">{posContent}</td>
        <td className="py-1.5 text-right">{p.age}</td>
        <td className="py-1.5 text-right">{p.height}″</td>
        <td className="py-1.5 text-right">{p.weight}</td>
        <td className="py-1.5 text-right">{HAND_LABEL[p.hand_batting]}/{HAND_LABEL[p.hand_throw]}</td>
        <td className="py-1.5 text-right">{p.speed}</td>
        <td className="py-1.5 text-right">{p.stamina}</td>
        <td className="py-1.5 text-right">{p.ag}</td>
        <td className="py-1.5 text-right">{p.eye}</td>
        <td className="py-1.5 text-right">{p.avg}</td>
        <td className="py-1.5 text-right">{p.strength}</td>
        <td className="py-1.5 text-right">{p.play_intel}</td>
        <td className="py-1.5 text-right">{p.bunting}</td>
        <td className="py-1.5 text-right">{p.fielding}</td>
        <td className="py-1.5 text-right">{p.throw}</td>
        <td className="py-1.5 text-right font-semibold text-white">{totalSkill(p)}</td>
        {extra}
      </>
    );
  }

  // Check for duplicate positions (excluding DH which can appear once)
  const assignedPositions = lineup.map((p) => positions[p.id] ?? p.position);
  const posCounts: Record<string, number> = {};
  for (const pos of assignedPositions) {
    posCounts[pos] = (posCounts[pos] ?? 0) + 1;
  }
  const hasDuplicates = Object.entries(posCounts).some(([, count]) => count > 1);

  return (
    <div className="space-y-8">
      {/* Starting Lineup */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">Starting Lineup</h2>
        {lineup.length < 9 && (
          <p className="mb-2 rounded bg-red-900/40 px-3 py-2 text-sm text-red-300">
            Warning: Only {lineup.length} of 9 lineup slots filled. Sign or activate more fielders.
          </p>
        )}
        {hasDuplicates && (
          <p className="mb-2 rounded bg-yellow-900/40 px-3 py-2 text-sm text-yellow-300">
            Warning: Duplicate positions assigned. Each position should be unique.
          </p>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>{skillHeaders}</thead>
            <tbody>
              {lineup.map((p, i) => {
                const currentPos = positions[p.id] ?? p.position;
                const isDuplicate = posCounts[currentPos] > 1;
                return (
                  <tr
                    key={p.id}
                    draggable
                    onDragStart={() => handleDragStart(i)}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => handleDrop(i)}
                    className={`border-b border-gray-800/50 cursor-grab text-gray-300 ${
                      dragIdx === i ? 'bg-blue-900/50' : ''
                    }`}
                  >
                    <td className="py-1.5 w-8 text-center text-gray-500">{i + 1}</td>
                    {playerCells(
                      p,
                      <select
                        value={currentPos}
                        onChange={(e) => changePosition(p.id, e.target.value)}
                        className={`rounded px-1.5 py-0.5 text-xs font-medium ${
                          isDuplicate
                            ? 'bg-yellow-900/50 text-yellow-300'
                            : currentPos === 'DH'
                              ? 'bg-purple-900/50 text-purple-300'
                              : 'bg-gray-800 text-gray-300'
                        }`}
                      >
                        {LINEUP_POSITIONS.map((pos) => (
                          <option key={pos} value={pos}>{pos}</option>
                        ))}
                      </select>,
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={save}
            disabled={isPending || lineup.length !== 9}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {isPending ? 'Saving...' : 'Save Lineup'}
          </button>

          {message && (
            <p className={`text-sm ${message.includes('saved') ? 'text-green-400' : 'text-red-400'}`}>
              {message}
            </p>
          )}
        </div>
      </section>

      {/* Bench */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">Bench ({bench.length})</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-gray-400">
                <th className="pb-2 w-8"></th>
                <th className="pb-2">#</th>
                <th className="pb-2">Name</th>
                <th className="pb-2">Pos</th>
                <th className="pb-2 text-right">Age</th>
                <th className="pb-2 text-right">Ht</th>
                <th className="pb-2 text-right">Wt</th>
                <th className="pb-2 text-right">B/T</th>
                <th className="pb-2 text-right">SPD</th>
                <th className="pb-2 text-right">STA</th>
                <th className="pb-2 text-right">AG</th>
                <th className="pb-2 text-right">EYE</th>
                <th className="pb-2 text-right">AVG</th>
                <th className="pb-2 text-right">STR</th>
                <th className="pb-2 text-right">PI</th>
                <th className="pb-2 text-right">BNT</th>
                <th className="pb-2 text-right">FLD</th>
                <th className="pb-2 text-right">THR</th>
                <th className="pb-2 text-right font-semibold">TOT</th>
                <th className="pb-2 text-right">Swap</th>
              </tr>
            </thead>
            <tbody>
              {bench.map((p, i) => (
                <tr key={p.id} className="border-b border-gray-800/50 text-gray-500">
                  <td className="py-1.5 w-8 text-center text-gray-500">—</td>
                  {playerCells(
                    p,
                    <span className="rounded bg-gray-800 px-1.5 py-0.5 text-xs font-medium text-gray-500">B{i + 1}</span>,
                    <td className="py-1.5 text-right">
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
                          <option value="" disabled>Swap…</option>
                          {lineup.map((l, i) => (
                            <option key={l.id} value={i}>
                              {i + 1}. {l.last_name}
                            </option>
                          ))}
                        </select>
                      )}
                    </td>,
                  )}
                </tr>
              ))}
              {bench.length === 0 && (
                <tr><td colSpan={20} className="py-4 text-center text-gray-500">No bench players</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
