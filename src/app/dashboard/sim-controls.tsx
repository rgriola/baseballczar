'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SimControls() {
  const router = useRouter();
  const [simming, setSimming] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [message, setMessage] = useState('');

  async function handleSimAll() {
    if (!confirm('Simulate all remaining games in the season?')) return;
    setSimming(true);
    setMessage('Simulating season... this may take a minute.');
    try {
      const res = await fetch('/api/sim/sim-all', { method: 'POST' });
      const data = await res.json();
      if (data.error) {
        setMessage(`Error: ${data.error}`);
      } else {
        setMessage(data.message);
      }
      router.refresh();
    } catch {
      setMessage('Sim failed — check console.');
    } finally {
      setSimming(false);
    }
  }

  async function handleReset() {
    if (!confirm('Reset entire season? All game results and stats will be erased.')) return;
    setResetting(true);
    setMessage('Resetting season...');
    try {
      const res = await fetch('/api/sim/reset', { method: 'POST' });
      const data = await res.json();
      if (data.error) {
        setMessage(`Error: ${data.error}`);
      } else {
        setMessage(data.message);
      }
      router.refresh();
    } catch {
      setMessage('Reset failed — check console.');
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="rounded-lg border border-yellow-700/50 bg-yellow-900/20 p-4">
      <h3 className="mb-2 text-sm font-semibold text-yellow-400 uppercase tracking-wide">
        Dev Controls (Temporary)
      </h3>
      <div className="flex flex-wrap gap-3">
        <button
          onClick={handleSimAll}
          disabled={simming || resetting}
          className="rounded bg-green-700 px-4 py-2 text-sm font-semibold text-white hover:bg-green-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {simming ? 'Simulating...' : '⚾ Simulate Full Season'}
        </button>
        <button
          onClick={handleReset}
          disabled={simming || resetting}
          className="rounded bg-red-700 px-4 py-2 text-sm font-semibold text-white hover:bg-red-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {resetting ? 'Resetting...' : '🔄 Reset Season'}
        </button>
      </div>
      {message && (
        <p className="mt-2 text-sm text-yellow-200">{message}</p>
      )}
    </div>
  );
}
