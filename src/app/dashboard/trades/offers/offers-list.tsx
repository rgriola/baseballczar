'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface EnrichedOffer {
  id: number;
  listing_id: number | null;
  from_team_id: number;
  to_team_id: number;
  offered_player_ids: number[] | null;
  cash_amount: number;
  status: string;
  created_at: string;
  fromTeamName: string;
  toTeamName: string;
  listedPlayerName: string | null;
  offeredPlayerNames: string[];
}

export default function OffersList({
  incoming,
  outgoing,
}: {
  incoming: EnrichedOffer[];
  outgoing: EnrichedOffer[];
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<Record<number, boolean>>({});

  async function respond(offerId: number, action: 'accept' | 'reject') {
    setBusy((b) => ({ ...b, [offerId]: true }));
    await fetch('/api/trades/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offerId, action }),
    });
    setBusy((b) => ({ ...b, [offerId]: false }));
    router.refresh();
  }

  return (
    <div className="space-y-8">
      {/* Incoming */}
      <section>
        <h2 className="text-lg font-semibold mb-3">
          Incoming Offers ({incoming.length})
        </h2>
        {incoming.length === 0 ? (
          <p className="text-gray-400 text-sm">No pending incoming offers.</p>
        ) : (
          <div className="space-y-3">
            {incoming.map((o) => (
              <div key={o.id} className="border border-gray-700 rounded p-4">
                <div className="flex justify-between items-start mb-2">
                  <div>
                    <span className="font-semibold text-blue-400">
                      {o.fromTeamName}
                    </span>
                    <span className="text-gray-400"> wants </span>
                    <span className="font-semibold">
                      {o.listedPlayerName ?? 'Unknown player'}
                    </span>
                  </div>
                  <span className="text-xs text-gray-500">
                    {new Date(o.created_at).toLocaleDateString()}
                  </span>
                </div>

                <div className="text-sm mb-3">
                  <span className="text-gray-400">Offering: </span>
                  {o.cash_amount > 0 && (
                    <span className="text-green-400">
                      ${o.cash_amount.toLocaleString()}
                    </span>
                  )}
                  {o.offeredPlayerNames.length > 0 && (
                    <span className="ml-2">
                      + {o.offeredPlayerNames.join(', ')}
                    </span>
                  )}
                  {o.cash_amount === 0 && o.offeredPlayerNames.length === 0 && (
                    <span className="text-red-400">Nothing (empty offer)</span>
                  )}
                </div>

                <div className="flex gap-2">
                  <button
                    className="px-3 py-1 bg-green-600 text-white rounded text-sm disabled:opacity-50"
                    disabled={busy[o.id]}
                    onClick={() => respond(o.id, 'accept')}
                  >
                    Accept
                  </button>
                  <button
                    className="px-3 py-1 bg-red-700 text-white rounded text-sm disabled:opacity-50"
                    disabled={busy[o.id]}
                    onClick={() => respond(o.id, 'reject')}
                  >
                    Reject
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Outgoing */}
      <section>
        <h2 className="text-lg font-semibold mb-3">
          My Offers ({outgoing.length})
        </h2>
        {outgoing.length === 0 ? (
          <p className="text-gray-400 text-sm">No outgoing offers.</p>
        ) : (
          <div className="space-y-2">
            {outgoing.map((o) => (
              <div
                key={o.id}
                className="flex items-center justify-between border border-gray-700 rounded px-4 py-2"
              >
                <div>
                  <span className="text-gray-400">To </span>
                  <span className="font-semibold">{o.toTeamName}</span>
                  <span className="text-gray-400"> for </span>
                  <span>{o.listedPlayerName ?? 'Unknown'}</span>
                  {o.cash_amount > 0 && (
                    <span className="ml-2 text-green-400">
                      ${o.cash_amount.toLocaleString()}
                    </span>
                  )}
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded ${
                    o.status === 'pending'
                      ? 'bg-yellow-800 text-yellow-200'
                      : o.status === 'accepted'
                        ? 'bg-green-800 text-green-200'
                        : 'bg-red-800 text-red-200'
                  }`}
                >
                  {o.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
