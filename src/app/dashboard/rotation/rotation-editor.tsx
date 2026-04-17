'use client';

import { useState, useTransition } from 'react';
import { updateRotation } from '../actions';

const HAND: Record<number, string> = { 1: 'R', 2: 'L' };

interface Pitcher {
  id: number;
  first_name: string;
  last_name: string;
  jersey_no: number;
  rotation_slot: number;
  stamina: number;
  ag: number;
  eye: number;
  avg: number;
  strength: number;
  dhr: number;
  play_intel: number;
  hand_throw: number;
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

  function PitcherRow({ p, actions }: { p: Pitcher; actions: React.ReactNode }) {
    return (
      <div className="flex items-center justify-between rounded bg-gray-900 px-4 py-2 text-sm">
        <div className="flex items-center gap-3">
          <span className="text-white">#{p.jersey_no} {p.first_name} {p.last_name}</span>
          <span className="text-xs text-gray-500">{HAND[p.hand_throw]}</span>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-xs text-gray-400">
            STA:{p.stamina} PI:{p.play_intel} STR:{p.strength}
          </span>
          {actions}
        </div>
      </div>
    );
  }

  const btnCls = 'rounded bg-gray-800 px-2 py-1 text-xs text-gray-300 hover:bg-gray-700';

  return (
    <div className="space-y-8">
      <div className="grid gap-8 lg:grid-cols-3">
        <section>
          <h2 className="mb-3 text-lg font-semibold text-white">Starting Rotation ({rotation.length}/5)</h2>
          <div className="space-y-1">
            {rotation.map((p, i) => (
              <div key={p.id} className="flex items-center gap-2">
                <span className="w-8 text-center text-sm text-gray-500">SP{i + 1}</span>
                <div className="flex-1">
                  <PitcherRow p={p} actions={<button onClick={() => remove(p)} className={btnCls}>✕</button>} />
                </div>
              </div>
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-white">Bullpen ({bullpen.length}/4)</h2>
          <div className="space-y-1">
            {bullpen.map((p) => (
              <PitcherRow key={p.id} p={p} actions={<button onClick={() => remove(p)} className={btnCls}>✕</button>} />
            ))}
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-semibold text-white">Available ({unassigned.length})</h2>
          <div className="space-y-1">
            {unassigned.map((p) => (
              <PitcherRow
                key={p.id}
                p={p}
                actions={
                  <div className="flex gap-1">
                    {rotation.length < 5 && (
                      <button onClick={() => moveToRotation(p)} className={btnCls}>→ SP</button>
                    )}
                    {bullpen.length < 4 && (
                      <button onClick={() => moveToBullpen(p)} className={btnCls}>→ RP</button>
                    )}
                  </div>
                }
              />
            ))}
          </div>
        </section>
      </div>

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
  );
}
