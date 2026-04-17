'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

const OUTCOME_LABELS: Record<number, string> = {
  1: 'Single',
  2: 'Double',
  3: 'Triple',
  4: 'Home Run',
  5: 'Walk',
  6: 'Ground Out',
  7: 'Strikeout',
};

const OUTCOME_COLORS: Record<number, string> = {
  1: 'text-green-400',
  2: 'text-yellow-400',
  3: 'text-orange-400',
  4: 'text-red-400',
  5: 'text-blue-400',
  6: 'text-gray-500',
  7: 'text-gray-500',
};

interface Event {
  id: number;
  seq: number;
  inning: number;
  half: 'top' | 'bottom';
  outs: number;
  batter_name: string;
  pitcher_name: string;
  outcome: number;
  description: string | null;
  visitor_runs: number;
  home_runs: number;
  visitor_hits: number;
  home_hits: number;
  runners_scored: string[] | null;
}

interface Props {
  events: Event[];
  homeName: string;
  visitorName: string;
  gameId: number;
  isLive: boolean;
}

export default function PlayByPlay({ events: initialEvents, homeName, visitorName, gameId, isLive }: Props) {
  const [events, setEvents] = useState<Event[]>(initialEvents);
  const bottomRef = useRef<HTMLDivElement>(null);

  // Subscribe to realtime inserts if game is live
  useEffect(() => {
    if (!isLive) return;

    const supabase = createClient();
    const channel = supabase
      .channel(`game-${gameId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'game_events',
          filter: `game_id=eq.${gameId}`,
        },
        (payload) => {
          setEvents((prev) => [...prev, payload.new as Event]);
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [gameId, isLive]);

  // Auto-scroll to bottom on new events
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [events.length]);

  // Group events by inning half
  const groups: { label: string; events: Event[] }[] = [];
  let currentKey = '';
  for (const ev of events) {
    const key = `${ev.inning}-${ev.half}`;
    if (key !== currentKey) {
      currentKey = key;
      const halfLabel = ev.half === 'top' ? 'Top' : 'Bottom';
      const teamBatting = ev.half === 'top' ? visitorName : homeName;
      groups.push({
        label: `${halfLabel} ${ev.inning} — ${teamBatting}`,
        events: [],
      });
    }
    groups[groups.length - 1].events.push(ev);
  }

  if (events.length === 0) {
    return (
      <section>
        <h2 className="mb-3 text-lg font-semibold text-white">Play-by-Play</h2>
        <p className="text-sm text-gray-500">
          {isLive ? 'Waiting for game events...' : 'No play-by-play data available.'}
        </p>
      </section>
    );
  }

  return (
    <section>
      <h2 className="mb-3 text-lg font-semibold text-white">Play-by-Play</h2>
      <div className="max-h-[600px] space-y-4 overflow-y-auto rounded-lg bg-gray-900 p-4">
        {groups.map((group, gi) => (
          <div key={gi}>
            <div className="sticky top-0 z-10 mb-2 bg-gray-900 py-1">
              <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                {group.label}
              </span>
            </div>
            <div className="space-y-1">
              {group.events.map((ev) => (
                <div key={ev.id} className="flex items-start gap-3 text-sm">
                  <span className="mt-0.5 w-5 shrink-0 text-right text-[10px] text-gray-600">
                    {ev.outs}o
                  </span>
                  <div className="flex-1">
                    <span className="text-gray-400">{ev.batter_name} vs {ev.pitcher_name}: </span>
                    <span className={OUTCOME_COLORS[ev.outcome] ?? 'text-gray-300'}>
                      {OUTCOME_LABELS[ev.outcome] ?? `Outcome ${ev.outcome}`}
                    </span>
                    {ev.description && (
                      <span className="text-gray-500"> — {ev.description}</span>
                    )}
                    {ev.runners_scored && ev.runners_scored.length > 0 && (
                      <span className="ml-2 text-yellow-400">
                        ({ev.runners_scored.join(', ')} scored)
                      </span>
                    )}
                  </div>
                  <span className="shrink-0 text-xs text-gray-600">
                    {ev.visitor_runs}-{ev.home_runs}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </section>
  );
}
