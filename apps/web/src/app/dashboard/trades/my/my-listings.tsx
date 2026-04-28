'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface Player {
  id: number;
  first_name: string;
  last_name: string;
  position: string;
  age: number;
  salary: number;
}

interface ListingWithPlayer {
  id: number;
  player_id: number;
  asking_price: number;
  status: string;
  player: Player | null;
}

export default function MyListings({
  listings,
  availablePlayers,
}: {
  listings: ListingWithPlayer[];
  availablePlayers: Player[];
}) {
  const router = useRouter();
  const [selectedPlayer, setSelectedPlayer] = useState('');
  const [askingPrice, setAskingPrice] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function listPlayer() {
    if (!selectedPlayer) return;
    setBusy(true);
    setMessage('');

    const body: Record<string, unknown> = {
      playerId: parseInt(selectedPlayer, 10),
    };
    if (askingPrice) {
      body.askingPrice = parseInt(askingPrice, 10);
    }

    const res = await fetch('/api/trades/list', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    setBusy(false);
    if (res.ok) {
      setMessage(`Listed! Asking price: $${data.askingPrice?.toLocaleString()}`);
      setSelectedPlayer('');
      setAskingPrice('');
      router.refresh();
    } else {
      setMessage(data.error || 'Error');
    }
  }

  async function withdrawListing(listingId: number) {
    const res = await fetch('/api/trades/withdraw', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingId }),
    });

    if (res.ok) {
      router.refresh();
    }
  }

  return (
    <div className="space-y-6">
      {/* List a new player */}
      <div className="border border-gray-700 rounded p-4">
        <h2 className="text-lg font-semibold mb-3">List a Player</h2>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            className="px-2 py-1 bg-gray-800 border border-gray-600 rounded text-sm"
            value={selectedPlayer}
            onChange={(e) => setSelectedPlayer(e.target.value)}
          >
            <option value="">Select player...</option>
            {availablePlayers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.first_name} {p.last_name} ({p.position}, age {p.age})
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            <label className="text-sm text-gray-400">Asking $</label>
            <input
              type="number"
              min={0}
              placeholder="Auto-value"
              className="w-32 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-sm"
              value={askingPrice}
              onChange={(e) => setAskingPrice(e.target.value)}
            />
          </div>
          <button
            className="px-3 py-1 bg-green-600 text-white rounded text-sm disabled:opacity-50"
            disabled={!selectedPlayer || busy}
            onClick={listPlayer}
          >
            {busy ? 'Listing...' : 'List for Trade'}
          </button>
        </div>
        {message && <p className="mt-2 text-sm text-yellow-300">{message}</p>}
      </div>

      {/* Current listings */}
      <div>
        <h2 className="text-lg font-semibold mb-3">
          Active Listings ({listings.length})
        </h2>
        {listings.length === 0 ? (
          <p className="text-gray-400 text-sm">No active listings.</p>
        ) : (
          <div className="space-y-2">
            {listings.map((l) => (
              <div
                key={l.id}
                className="flex items-center justify-between border border-gray-700 rounded px-4 py-2"
              >
                <div>
                  <span className="font-semibold">
                    {l.player?.first_name} {l.player?.last_name}
                  </span>
                  <span className="ml-2 text-sm text-gray-400">
                    {l.player?.position}
                  </span>
                  <span className="ml-3 text-green-400">
                    ${l.asking_price.toLocaleString()}
                  </span>
                </div>
                <button
                  className="px-2 py-1 bg-red-700 text-white rounded text-xs"
                  onClick={() => withdrawListing(l.id)}
                >
                  Withdraw
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
