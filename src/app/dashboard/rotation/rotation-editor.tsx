'use client';

import { useState, useTransition } from 'react';
import { updateRotation } from '../actions';
import { CountryFlag } from '../roster/country-flag';

const HAND_LABEL: Record<number, string> = { 1: 'R', 2: 'L', 3: 'S' };

interface Pitcher {
  id: number;
  first_name: string;
  last_name: string;
  jersey_no: number;
  rotation_slot: number;
  age: number;
  height: number;
  weight: number;
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

function totalSkill(p: Pitcher) {
  return +(p.speed + p.stamina + p.ag + p.eye + p.avg + p.strength + p.play_intel + p.bunting + p.fielding + p.throw).toFixed(1);
}

export default function RotationEditor({ pitchers }: { pitchers: Pitcher[] }) {
  const [rotation, setRotation] = useState<Pitcher[]>(
    pitchers.filter((p) => p.rotation_slot >= 1 && p.rotation_slot <= 5).sort((a, b) => a.rotation_slot - b.rotation_slot),
  );
  const [bullpen, setBullpen] = useState<Pitcher[]>(
    pitchers.filter((p) => p.rotation_slot >= 6 && p.rotation_slot <= 9).sort((a, b) => a.rotation_slot - b.rotation_slot),
  );
  const [unassigned, setUnassigned] = useState<Pitcher[]>(
    pitchers.filter((p) => p.rotation_slot === 0 || p.rotation_slot > 9),
  );
  const [dragIdx, setDragIdx] = useState<{ group: 'rotation' | 'bullpen'; idx: number } | null>(null);
  const [isPending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  function moveToRotation(p: Pitcher) {
    if (rotation.length >= 5) return;
    setRotation([...rotation, p]);
    setBullpen(bullpen.filter((b) => b.id !== p.id));
    setUnassigned(unassigned.filter((u) => u.id !== p.id));
  }

  function moveToBullpen(p: Pitcher) {
    if (bullpen.length >= 4) return;
    setBullpen([...bullpen, p]);
    setRotation(rotation.filter((r) => r.id !== p.id));
    setUnassigned(unassigned.filter((u) => u.id !== p.id));
  }

  function remove(p: Pitcher) {
    setUnassigned([...unassigned, p]);
    setRotation(rotation.filter((r) => r.id !== p.id));
    setBullpen(bullpen.filter((b) => b.id !== p.id));
  }

  function handleDragStartRotation(idx: number) {
    setDragIdx({ group: 'rotation', idx });
  }

  function handleDropRotation(targetIdx: number) {
    if (!dragIdx || dragIdx.group !== 'rotation' || dragIdx.idx === targetIdx) { setDragIdx(null); return; }
    const next = [...rotation];
    const [moved] = next.splice(dragIdx.idx, 1);
    next.splice(targetIdx, 0, moved);
    setRotation(next);
    setDragIdx(null);
  }

  function handleDragStartBullpen(idx: number) {
    setDragIdx({ group: 'bullpen', idx });
  }

  function handleDropBullpen(targetIdx: number) {
    if (!dragIdx || dragIdx.group !== 'bullpen' || dragIdx.idx === targetIdx) { setDragIdx(null); return; }
    const next = [...bullpen];
    const [moved] = next.splice(dragIdx.idx, 1);
    next.splice(targetIdx, 0, moved);
    setBullpen(next);
    setDragIdx(null);
  }

  function save() {
    if (rotation.length < 1) {
      setMessage('Need at least 1 starting pitcher');
      return;
    }
    const fd = new FormData();
    fd.set('pitcherIds', JSON.stringify(rotation.map((p) => p.id)));
    fd.set('bullpenIds', JSON.stringify(bullpen.map((p) => p.id)));
    startTransition(async () => {
      const result = await updateRotation(fd);
      setMessage(result?.error ?? 'Rotation saved!');
    });
  }

  const tableHeaders = (
    <tr className="border-b border-gray-800 text-left text-gray-400">
      <th className="pb-2 w-10"></th>
      <th className="pb-2">#</th>
      <th className="pb-2">Name</th>
      <th className="pb-2 text-right">Age</th>
      <th className="pb-2 text-right">Ht</th>
      <th className="pb-2 text-right">Wt</th>
      <th className="pb-2 text-right">T</th>
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
      <th className="pb-2 w-10"></th>
    </tr>
  );

  function pitcherCells(p: Pitcher) {
    return (
      <>
        <td className="py-1.5">{p.jersey_no}</td>
        <td className="py-1.5 font-medium whitespace-nowrap"><CountryFlag countryId={p.country_id} /> {p.first_name} {p.last_name}</td>
        <td className="py-1.5 text-right">{p.age}</td>
        <td className="py-1.5 text-right">{p.height}″</td>
        <td className="py-1.5 text-right">{p.weight}</td>
        <td className="py-1.5 text-right">{HAND_LABEL[p.hand_throw]}</td>
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
      </>
    );
  }

  const removeBtnCls = 'rounded bg-red-900/40 px-2 py-0.5 text-xs text-red-400 hover:bg-red-800/50';

  return (
    <div className="space-y-8">
      {/* Starting Rotation */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">Starting Rotation ({rotation.length}/5)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>{tableHeaders}</thead>
            <tbody>
              {rotation.map((p, i) => (
                <tr
                  key={p.id}
                  draggable
                  onDragStart={() => handleDragStartRotation(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDropRotation(i)}
                  className={`border-b border-gray-800/50 cursor-grab text-gray-300 ${
                    dragIdx?.group === 'rotation' && dragIdx.idx === i ? 'bg-blue-900/50' : ''
                  }`}
                >
                  <td className="py-1.5 w-10 text-center">
                    <span className="rounded bg-green-900/50 px-1.5 py-0.5 text-xs font-medium text-green-400">SP{i + 1}</span>
                  </td>
                  {pitcherCells(p)}
                  <td className="py-1.5 w-10 text-center">
                    <button onClick={() => remove(p)} className={removeBtnCls}>✕</button>
                  </td>
                </tr>
              ))}
              {rotation.length === 0 && (
                <tr><td colSpan={19} className="py-4 text-center text-gray-500">No starters assigned — add pitchers from Available below</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Bullpen */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">Bullpen ({bullpen.length}/4)</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>{tableHeaders}</thead>
            <tbody>
              {bullpen.map((p, i) => (
                <tr
                  key={p.id}
                  draggable
                  onDragStart={() => handleDragStartBullpen(i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => handleDropBullpen(i)}
                  className={`border-b border-gray-800/50 cursor-grab text-gray-300 ${
                    dragIdx?.group === 'bullpen' && dragIdx.idx === i ? 'bg-blue-900/50' : ''
                  }`}
                >
                  <td className="py-1.5 w-10 text-center">
                    <span className="rounded bg-yellow-900/50 px-1.5 py-0.5 text-xs font-medium text-yellow-400">RP{i + 1}</span>
                  </td>
                  {pitcherCells(p)}
                  <td className="py-1.5 w-10 text-center">
                    <button onClick={() => remove(p)} className={removeBtnCls}>✕</button>
                  </td>
                </tr>
              ))}
              {bullpen.length === 0 && (
                <tr><td colSpan={19} className="py-4 text-center text-gray-500">No relievers assigned</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* Available */}
      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">Available ({unassigned.length})</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-gray-800 text-left text-gray-400">
                <th className="pb-2 w-10"></th>
                <th className="pb-2">#</th>
                <th className="pb-2">Name</th>
                <th className="pb-2 text-right">Age</th>
                <th className="pb-2 text-right">Ht</th>
                <th className="pb-2 text-right">Wt</th>
                <th className="pb-2 text-right">T</th>
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
                <th className="pb-2 w-24 text-right">Assign</th>
              </tr>
            </thead>
            <tbody>
              {unassigned.map((p) => (
                <tr key={p.id} className="border-b border-gray-800/50 text-gray-500">
                  <td className="py-1.5 w-10 text-center text-gray-600">—</td>
                  {pitcherCells(p)}
                  <td className="py-1.5 w-24 text-right">
                    <div className="flex justify-end gap-1">
                      {rotation.length < 5 && (
                        <button onClick={() => moveToRotation(p)} className="rounded bg-green-900/40 px-2 py-0.5 text-xs text-green-400 hover:bg-green-800/50">→ SP</button>
                      )}
                      {bullpen.length < 4 && (
                        <button onClick={() => moveToBullpen(p)} className="rounded bg-yellow-900/40 px-2 py-0.5 text-xs text-yellow-400 hover:bg-yellow-800/50">→ RP</button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {unassigned.length === 0 && (
                <tr><td colSpan={19} className="py-4 text-center text-gray-500">All pitchers assigned</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className="flex items-center gap-3">
        <button
          onClick={save}
          disabled={isPending || rotation.length < 1}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {isPending ? 'Saving...' : 'Save Rotation'}
        </button>

        {message && (
          <p className={`text-sm ${message.includes('saved') ? 'text-green-400' : 'text-red-400'}`}>
            {message}
          </p>
        )}
      </div>
    </div>
  );
}
