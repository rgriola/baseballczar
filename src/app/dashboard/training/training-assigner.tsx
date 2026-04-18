'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface PlayerData {
  id: number;
  name: string;
  position: string;
  age: number;
  rosterStatus: string;
  trainingSlot: number;
  lastImprovement: number;
  skills: Record<string, number>;
  maxSkills: Record<string, number>;
}

interface SlotInfo {
  slot: number;
  skill: string;
  max: string;
  label: string;
}

export default function TrainingAssigner({
  players,
  skillSlots,
}: {
  players: PlayerData[];
  skillSlots: SlotInfo[];
}) {
  const [assignments, setAssignments] = useState<Record<number, number>>(
    () => {
      const init: Record<number, number> = {};
      for (const p of players) {
        init[p.id] = p.trainingSlot;
      }
      return init;
    },
  );
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const router = useRouter();

  const dirty = players.some((p) => assignments[p.id] !== p.trainingSlot);

  async function handleSave() {
    setSaving(true);
    setMessage('');

    // Only send changed assignments
    const changes: { playerId: number; slot: number }[] = [];
    for (const p of players) {
      if (assignments[p.id] !== p.trainingSlot) {
        changes.push({ playerId: p.id, slot: assignments[p.id] });
      }
    }

    const res = await fetch('/api/training/assign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assignments: changes }),
    });

    if (res.ok) {
      setMessage(`Saved ${changes.length} assignment(s).`);
      router.refresh();
    } else {
      const data = await res.json();
      setMessage(data.error ?? 'Failed to save');
    }
    setSaving(false);
  }

  return (
    <div>
      <div className="mb-4 flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={saving || !dirty}
          className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {saving ? 'Saving...' : 'Save Assignments'}
        </button>
        {message && (
          <span className="text-sm text-green-400">{message}</span>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800 text-left text-gray-400">
              <th className="pb-2">Player</th>
              <th className="pb-2">Pos</th>
              <th className="pb-2 text-right">Age</th>
              {skillSlots.map((s) => (
                <th key={s.slot} className="pb-2 text-right text-xs">
                  {s.label}
                </th>
              ))}
              <th className="pb-2">Training</th>
              <th className="pb-2 text-right">Last +</th>
            </tr>
          </thead>
          <tbody>
            {players.map((p) => {
              const canTrain = p.age < 30;
              return (
                <tr
                  key={p.id}
                  className={`border-b border-gray-800/50 ${
                    canTrain ? 'text-gray-300' : 'text-gray-600'
                  }`}
                >
                  <td className="py-1.5 whitespace-nowrap">{p.name}</td>
                  <td className="py-1.5">{p.position}</td>
                  <td className="py-1.5 text-right">{p.age}</td>
                  {skillSlots.map((s) => {
                    const val = p.skills[s.skill] ?? 0;
                    const max = p.maxSkills[s.skill] ?? 10;
                    const isMaxed = val >= max;
                    const isTraining = assignments[p.id] === s.slot;
                    return (
                      <td
                        key={s.slot}
                        className={`py-1.5 text-right font-mono text-xs ${
                          isMaxed
                            ? 'text-yellow-500'
                            : isTraining
                            ? 'text-green-400 font-bold'
                            : ''
                        }`}
                      >
                        {typeof val === 'number' ? val.toFixed(1) : val}
                        <span className="text-gray-700">/{max}</span>
                      </td>
                    );
                  })}
                  <td className="py-1.5">
                    {canTrain ? (
                      <select
                        value={assignments[p.id] ?? 0}
                        onChange={(e) =>
                          setAssignments((prev) => ({
                            ...prev,
                            [p.id]: Number(e.target.value),
                          }))
                        }
                        className="rounded border border-gray-700 bg-gray-900 px-2 py-0.5 text-xs text-white"
                      >
                        <option value={0}>— None —</option>
                        {skillSlots.map((s) => {
                          const val = p.skills[s.skill] ?? 0;
                          const max = p.maxSkills[s.skill] ?? 10;
                          const isMaxed = val >= max;
                          return (
                            <option
                              key={s.slot}
                              value={s.slot}
                              disabled={isMaxed}
                            >
                              {s.label}
                              {isMaxed ? ' (MAX)' : ''}
                            </option>
                          );
                        })}
                      </select>
                    ) : (
                      <span className="text-xs text-gray-600">Too old</span>
                    )}
                  </td>
                  <td className="py-1.5 text-right font-mono text-xs text-green-400">
                    {p.lastImprovement > 0
                      ? `+${p.lastImprovement.toFixed(2)}`
                      : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="mt-4 text-xs text-gray-600">
        <span className="text-yellow-500">Yellow</span> = maxed skill |{' '}
        <span className="font-bold text-green-400">Green</span> = currently training
      </div>
    </div>
  );
}
