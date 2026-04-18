'use client';

import { useState } from 'react';

interface Player {
  id: number;
  first_name: string;
  last_name: string;
  age: number;
  position: string;
  fielder: boolean;
  speed: number;
  stamina: number;
  play_intel: number;
  avg: number;
  strength: number;
  eye: number;
  bunting: number;
  throw: number;
  fielding: number;
  salary: number;
}

interface Listing {
  id: number;
  seller_team_id: number;
  player_id: number;
  asking_price: number;
  created_at: string;
  player: Player | null;
  sellerTeam: { id: number; team_name: string } | null;
}

export default function TradeBlockBrowser({
  listings,
  myTeamId,
}: {
  listings: Listing[];
  myTeamId: number;
}) {
  const [offerState, setOfferState] = useState<Record<number, { cash: string; sending: boolean }>>({});
  const [result, setResult] = useState<Record<number, string>>({});

  async function submitOffer(listingId: number) {
    const state = offerState[listingId];
    const cash = parseInt(state?.cash || '0', 10);
    if (isNaN(cash) || cash < 0) return;

    setOfferState((s) => ({ ...s, [listingId]: { ...s[listingId], sending: true } }));

    const res = await fetch('/api/trades/offer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ listingId, cashAmount: cash, offeredPlayerIds: [] }),
    });

    const data = await res.json();
    setOfferState((s) => ({ ...s, [listingId]: { ...s[listingId], sending: false } }));
    setResult((r) => ({
      ...r,
      [listingId]: res.ok ? 'Offer submitted!' : data.error || 'Error',
    }));
  }

  return (
    <div className="space-y-4">
      {listings.map((l) => {
        const p = l.player;
        if (!p) return null;
        const isMine = l.seller_team_id === myTeamId;

        return (
          <div key={l.id} className="border border-gray-700 rounded p-4">
            <div className="flex justify-between items-start mb-2">
              <div>
                <span className="font-semibold text-lg">
                  {p.first_name} {p.last_name}
                </span>
                <span className="ml-2 text-sm text-gray-400">
                  {p.position} · Age {p.age}
                </span>
              </div>
              <div className="text-right">
                <div className="text-sm text-gray-400">
                  {l.sellerTeam?.team_name ?? 'Unknown'}
                </div>
                <div className="font-semibold text-green-400">
                  Asking: ${l.asking_price.toLocaleString()}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-9 gap-2 text-xs text-center mb-3">
              {(['speed', 'stamina', 'play_intel', 'avg', 'strength', 'eye', 'bunting', 'throw', 'fielding'] as const).map(
                (skill) => (
                  <div key={skill}>
                    <div className="text-gray-500 uppercase">{skill.slice(0, 3)}</div>
                    <div className="font-mono">{p[skill]}</div>
                  </div>
                ),
              )}
            </div>

            <div className="text-xs text-gray-500 mb-2">
              Salary: ${p.salary.toLocaleString()}/week
            </div>

            {!isMine && (
              <div className="flex items-center gap-2">
                <label className="text-sm">Cash offer: $</label>
                <input
                  type="number"
                  min={0}
                  className="w-32 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-sm"
                  value={offerState[l.id]?.cash ?? ''}
                  onChange={(e) =>
                    setOfferState((s) => ({
                      ...s,
                      [l.id]: { cash: e.target.value, sending: false },
                    }))
                  }
                />
                <button
                  className="px-3 py-1 bg-blue-600 text-white rounded text-sm disabled:opacity-50"
                  disabled={offerState[l.id]?.sending}
                  onClick={() => submitOffer(l.id)}
                >
                  {offerState[l.id]?.sending ? 'Sending...' : 'Make Offer'}
                </button>
                {result[l.id] && (
                  <span className="text-sm text-yellow-300">{result[l.id]}</span>
                )}
              </div>
            )}
            {isMine && (
              <span className="text-xs text-gray-500 italic">Your listing</span>
            )}
          </div>
        );
      })}
    </div>
  );
}
