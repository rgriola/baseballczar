'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

export default function SignPlayerButton({
  playerId,
  playerName,
  salary,
  canAfford,
}: {
  playerId: number;
  playerName: string;
  salary: number;
  canAfford: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const router = useRouter();

  async function handleSign() {
    if (!confirm(`Sign ${playerName} for $${salary.toLocaleString()}/week?`)) return;
    setLoading(true);
    setError('');

    const res = await fetch('/api/market/sign', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId }),
    });

    const data = await res.json();

    if (!res.ok) {
      setError(data.error ?? 'Failed to sign player');
      setLoading(false);
      return;
    }

    router.refresh();
  }

  return (
    <div>
      <button
        onClick={handleSign}
        disabled={loading || !canAfford}
        className="rounded bg-green-600 px-2 py-1 text-xs font-medium text-white hover:bg-green-500 disabled:opacity-50"
      >
        {loading ? '...' : 'Sign'}
      </button>
      {!canAfford && !error && (
        <p className="mt-0.5 text-[10px] text-red-400">Over budget</p>
      )}
      {error && <p className="mt-0.5 text-[10px] text-red-400">{error}</p>}
    </div>
  );
}
