'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';

interface EnrichedChallenge {
  id: number;
  challenger_team_id: number;
  challenged_team_id: number;
  wager: number;
  status: string;
  game_id: number | null;
  created_at: string;
  challengerName: string;
  challengedName: string;
}

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-800 text-yellow-200',
  accepted: 'bg-blue-800 text-blue-200',
  declined: 'bg-red-800 text-red-200',
  completed: 'bg-green-800 text-green-200',
  expired: 'bg-gray-700 text-gray-300',
};

export default function ChallengePanel({
  myTeamId,
  opponents,
  sent,
  received,
}: {
  myTeamId: number;
  opponents: { id: number; team_name: string }[];
  sent: EnrichedChallenge[];
  received: EnrichedChallenge[];
}) {
  const router = useRouter();
  const [targetTeam, setTargetTeam] = useState('');
  const [wager, setWager] = useState('0');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [respondBusy, setRespondBusy] = useState<Record<number, boolean>>({});

  async function sendChallenge() {
    if (!targetTeam) return;
    setBusy(true);
    setMessage('');

    const res = await fetch('/api/challenges/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        challengedTeamId: parseInt(targetTeam, 10),
        wager: parseInt(wager, 10) || 0,
      }),
    });

    const data = await res.json();
    setBusy(false);
    setMessage(res.ok ? 'Challenge sent!' : data.error || 'Error');
    if (res.ok) {
      setTargetTeam('');
      setWager('0');
      router.refresh();
    }
  }

  async function respondToChallenge(challengeId: number, action: 'accept' | 'decline') {
    setRespondBusy((b) => ({ ...b, [challengeId]: true }));

    await fetch('/api/challenges/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ challengeId, action }),
    });

    setRespondBusy((b) => ({ ...b, [challengeId]: false }));
    router.refresh();
  }

  return (
    <div className="space-y-8">
      {/* Send challenge */}
      <section className="border border-gray-700 rounded p-4">
        <h2 className="text-lg font-semibold mb-3">Send a Challenge</h2>
        <div className="flex items-center gap-3 flex-wrap">
          <select
            className="px-2 py-1 bg-gray-800 border border-gray-600 rounded text-sm"
            value={targetTeam}
            onChange={(e) => setTargetTeam(e.target.value)}
          >
            <option value="">Select opponent...</option>
            {opponents.map((t) => (
              <option key={t.id} value={t.id}>
                {t.team_name}
              </option>
            ))}
          </select>
          <div className="flex items-center gap-1">
            <label className="text-sm text-gray-400">Wager $</label>
            <input
              type="number"
              min={0}
              max={500000}
              className="w-28 px-2 py-1 bg-gray-800 border border-gray-600 rounded text-sm"
              value={wager}
              onChange={(e) => setWager(e.target.value)}
            />
          </div>
          <button
            className="px-3 py-1 bg-blue-600 text-white rounded text-sm disabled:opacity-50"
            disabled={!targetTeam || busy}
            onClick={sendChallenge}
          >
            {busy ? 'Sending...' : 'Send Challenge'}
          </button>
        </div>
        {message && <p className="mt-2 text-sm text-yellow-300">{message}</p>}
      </section>

      {/* Incoming (pending) */}
      <section>
        <h2 className="text-lg font-semibold mb-3">
          Incoming Challenges ({received.filter((c) => c.status === 'pending').length} pending)
        </h2>
        {received.filter((c) => c.status === 'pending').length === 0 ? (
          <p className="text-gray-400 text-sm">No pending challenges.</p>
        ) : (
          <div className="space-y-2">
            {received
              .filter((c) => c.status === 'pending')
              .map((c) => (
                <div
                  key={c.id}
                  className="flex items-center justify-between border border-gray-700 rounded px-4 py-3"
                >
                  <div>
                    <span className="font-semibold text-blue-400">
                      {c.challengerName}
                    </span>
                    <span className="text-gray-400"> challenges you</span>
                    {c.wager > 0 && (
                      <span className="ml-2 text-green-400">
                        Wager: ${c.wager.toLocaleString()}
                      </span>
                    )}
                  </div>
                  <div className="flex gap-2">
                    <button
                      className="px-3 py-1 bg-green-600 text-white rounded text-sm disabled:opacity-50"
                      disabled={respondBusy[c.id]}
                      onClick={() => respondToChallenge(c.id, 'accept')}
                    >
                      Accept
                    </button>
                    <button
                      className="px-3 py-1 bg-red-700 text-white rounded text-sm disabled:opacity-50"
                      disabled={respondBusy[c.id]}
                      onClick={() => respondToChallenge(c.id, 'decline')}
                    >
                      Decline
                    </button>
                  </div>
                </div>
              ))}
          </div>
        )}
      </section>

      {/* History */}
      <section>
        <h2 className="text-lg font-semibold mb-3">Challenge History</h2>
        <div className="space-y-2">
          {[...sent, ...received]
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .slice(0, 20)
            .map((c) => {
              const isSent = c.challenger_team_id === myTeamId;
              return (
                <div
                  key={`${isSent ? 's' : 'r'}-${c.id}`}
                  className="flex items-center justify-between border border-gray-700 rounded px-4 py-2 text-sm"
                >
                  <div>
                    <span className="text-gray-400">{isSent ? 'Sent to ' : 'From '}</span>
                    <span className="font-semibold">
                      {isSent ? c.challengedName : c.challengerName}
                    </span>
                    {c.wager > 0 && (
                      <span className="ml-2 text-gray-500">
                        ${c.wager.toLocaleString()}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <span
                      className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[c.status] ?? 'bg-gray-700'}`}
                    >
                      {c.status}
                    </span>
                    {c.game_id && (
                      <a
                        href={`/dashboard/games/${c.game_id}`}
                        className="text-xs text-blue-400 underline"
                      >
                        Box Score
                      </a>
                    )}
                    <span className="text-xs text-gray-600">
                      {new Date(c.created_at).toLocaleDateString()}
                    </span>
                  </div>
                </div>
              );
            })}
        </div>
      </section>
    </div>
  );
}
