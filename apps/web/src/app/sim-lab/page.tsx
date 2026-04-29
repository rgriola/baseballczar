'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  createRng,
  generateMatchup,
  simulateGame,
  buildEvents,
  type SimEvent,
  type GameResult,
} from '@baseballczar/sim-engine';
import FieldCanvasV2Client from '@/components/sim-v2/FieldCanvasV2Client';
import { buildPbp, type PbpEntry } from '@/components/sim-v2/pbp';

interface SimRun {
  seed: number;
  result: GameResult;
  events: SimEvent[];
  derivedHome: number;
  derivedAway: number;
}

function runSim(seed: number): SimRun {
  const rng = createRng(seed);
  const { home, away } = generateMatchup(rng);
  const result = simulateGame(home, away, rng);
  const rawEvents = buildEvents(result);
  // Compress dead air: clamp any gap > 1.5s to 1.5s so the sandbox is
  // watchable without waiting 2 minutes between innings. Exception: the
  // pre-game gap (game-start → inning-start) and the first at-bat-start
  // need to preserve enough time for the take-the-field intro jog (~12s)
  // and the leadoff batter's walk-out from the dugout (~8s). Without
  // this, those tweens are still in mid-flight when the first pitch
  // fires.
  const events = compressTimeline(rawEvents, 1.5);
  let derivedHome = 0, derivedAway = 0;
  for (const e of events) {
    if (e.type === 'run-scored') {
      if (e.battingTeamId === result.homeTeam.id) derivedHome++;
      else derivedAway++;
    }
  }
  return { seed, result, events, derivedHome, derivedAway };
}

/**
 * Re-time an event stream so any gap larger than `maxGapSec` is clamped.
 * Preserves order; does not change anything else about the events.
 *
 * Exception: the pre-game gap before the first `inning-start`, and the
 * gap before the leadoff `at-bat-start`, are preserved up to longer
 * caps so the intro animations (take-the-field jog, batter walk-out)
 * have time to play out before the first pitch.
 */
function compressTimeline(events: SimEvent[], maxGapSec: number): SimEvent[] {
  if (events.length === 0) return events;
  const PREGAME_MAX_SEC = 14;     // covers the 12s intro-jog cap
  // Pull the leadoff at-bat-start up close to inning-start so the
  // batter starts walking out of the dugout while the fielders are
  // still jogging to position. Without this, the batter waits ~10s
  // after the fielders, then heads out alone.
  const FIRST_AB_MAX_SEC = 2;
  // Then leave enough room for the ~5s walk-out + buffer before the
  // first pitch fires.
  const FIRST_PITCH_MAX_SEC = 10;
  let firstInningStartSeen = false;
  let firstAtBatStartSeen = false;
  let firstPitchSeen = false;
  const out: SimEvent[] = [];
  let prevOrigT = events[0].t;
  let prevNewT = 0;
  // Track the in-flight duration of the most recent ball event so the
  // gap to the next event can stay long enough to let the flight finish.
  // Without this, a deep HR (5–6s hang) gets clamped to 1.5s and the
  // ball sprite jumps back to the catcher while the ball is still in
  // the air. Same idea for any contact event — the next event
  // (ball-return, runner-advance, etc.) often retargets the ball.
  let inFlightDur = 0;
  for (let i = 0; i < events.length; i++) {
    const e = events[i];
    let cap = maxGapSec;
    if (e.type === 'inning-start' && !firstInningStartSeen) {
      cap = PREGAME_MAX_SEC;
      firstInningStartSeen = true;
    } else if (e.type === 'at-bat-start' && !firstAtBatStartSeen) {
      cap = FIRST_AB_MAX_SEC;
      firstAtBatStartSeen = true;
    } else if (e.type === 'pitch' && !firstPitchSeen) {
      cap = FIRST_PITCH_MAX_SEC;
      firstPitchSeen = true;
    }
    // If the previous event put the ball in flight, ensure this gap is
    // at least long enough for the flight to play out (+ small buffer).
    if (inFlightDur > 0) {
      cap = Math.max(cap, inFlightDur + 0.5);
      inFlightDur = 0;
    }
    const gap = i === 0 ? 0 : Math.min(cap, e.t - prevOrigT);
    const newT = i === 0 ? e.t : prevNewT + gap;
    out.push({ ...e, t: newT });
    prevOrigT = e.t;
    prevNewT = newT;
    // Record this event's in-flight duration for the NEXT iteration.
    if (e.type === 'contact') {
      inFlightDur = e.hangTimeSec || 1.5;
    } else if (e.type === 'throw' || e.type === 'ball-return') {
      inFlightDur = e.flightSec || 0;
    } else if (e.type === 'runner-advance') {
      // Each base-to-base trot/sprint takes its own travelSec; without
      // this the next runner-advance fires after 1.5s and the runner
      // is yanked diagonally to the next bag mid-stride (looks like a
      // tight loop near the mound on a home-run trot).
      inFlightDur = e.travelSec || 0;
    }
  }
  return out;
}

export default function SimLabPage() {
  // Start with a fixed seed so SSR and first client render match.
  // Randomize after mount to avoid hydration mismatch.
  const [seed, setSeed] = useState<number>(1);
  const [pinned, setPinned] = useState<number>(1);

  useEffect(() => {
    const s = Math.floor(Math.random() * 100000);
    setSeed(s);
    setPinned(s);
  }, []);

  const sim = useMemo<SimRun>(() => runSim(pinned), [pinned]);

  const pbp = useMemo<PbpEntry[]>(() => buildPbp(sim.events), [sim.events]);
  const [cursor, setCursor] = useState<number>(0);
  // Reset cursor when seed changes (new sim)
  useEffect(() => { setCursor(0); }, [pinned]);

  const parityOk =
    sim.derivedHome === sim.result.homeRuns &&
    sim.derivedAway === sim.result.awayRuns;

  const eventCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of sim.events) m.set(e.type, (m.get(e.type) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [sim.events]);
  void eventCounts;

  return (
    <main className="min-h-screen bg-zinc-950 text-zinc-100 p-6">
      <div className="max-w-[1400px] mx-auto flex flex-col gap-4">
        <header className="flex items-baseline gap-3">
          <h1 className="text-2xl font-bold">Sim Lab</h1>
          <span className="text-zinc-500 text-sm">
            Stand-alone sandbox for the new physics engine.
          </span>
        </header>

        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3 p-3 bg-zinc-900 rounded-lg border border-zinc-800">
          <label className="flex items-center gap-2 text-sm">
            Seed:
            <input
              type="number"
              value={seed}
              onChange={(e) => setSeed(Number(e.target.value))}
              className="w-28 px-2 py-1 rounded bg-zinc-800 border border-zinc-700 font-mono"
            />
          </label>
          <button
            onClick={() => setPinned(seed)}
            className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-sm font-medium"
          >
            Run
          </button>
          <button
            onClick={() => {
              const s = Math.floor(Math.random() * 100000);
              setSeed(s);
              setPinned(s);
            }}
            className="px-3 py-1.5 rounded bg-zinc-700 hover:bg-zinc-600 text-sm"
          >
            🎲 Random
          </button>
          <div className="ml-auto flex items-center gap-3 text-sm">
            <span className="text-zinc-400">
              {sim.result.awayTeam.name} <span className="text-zinc-600">@</span> {sim.result.homeTeam.name}
            </span>
            <span className="font-mono font-bold tabular-nums text-lg">
              {sim.result.awayRuns} – {sim.result.homeRuns}
            </span>
            <span className={`text-xs px-2 py-0.5 rounded ${
              parityOk ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
            }`}>
              {parityOk ? '✓ events match' : `⚠ events ${sim.derivedAway}–${sim.derivedHome}`}
            </span>
          </div>
        </div>

        {/* Main: field + sidebar */}
        <div className="flex gap-4">
          <div className="flex-shrink-0">
            <FieldCanvasV2Client
              events={sim.events}
              autoplay={true}
              speed={2}
              onCursor={setCursor}
            />
          </div>

          <aside className="flex-1 min-w-0 flex flex-col gap-3">
            <PbpPanel entries={pbp} cursor={cursor} />

            <Panel title="Game Summary">
              <Row label="Innings" value={String(sim.result.innings)} />
              <Row label="At-bats" value={String(sim.result.atBats.length)} />
              <Row label="Events" value={String(sim.events.length)} />
              <Row label="Duration" value={`${(sim.events[sim.events.length - 1]?.t ?? 0).toFixed(1)} s sim time`} />
            </Panel>

            <Panel title="Box Score (raw)">
              <div className="text-xs font-mono whitespace-pre overflow-x-auto">
                {`Away ${sim.result.awayTeam.name.padEnd(14)} ${String(sim.result.awayRuns).padStart(2)} R
Home ${sim.result.homeTeam.name.padEnd(14)} ${String(sim.result.homeRuns).padStart(2)} R`}
              </div>
            </Panel>
          </aside>
        </div>
      </div>
    </main>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-3">
      <h2 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">{title}</h2>
      {children}
    </section>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between text-sm py-0.5">
      <span className="text-zinc-400">{label}</span>
      <span className="font-mono tabular-nums">{value}</span>
    </div>
  );
}

function PbpPanel({ entries, cursor }: { entries: PbpEntry[]; cursor: number }) {
  // Show entries up through the current cursor; highlight the most recent one.
  const listRef = useRef<HTMLDivElement | null>(null);
  const visible = entries.filter(e => e.eventIdx <= cursor);
  const lastIdx = visible.length - 1;

  // Auto-scroll the active line into view as it advances.
  useEffect(() => {
    const el = listRef.current?.querySelector<HTMLDivElement>(`[data-pbp-active="true"]`);
    if (el) el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [lastIdx]);

  const colorFor = (kind: PbpEntry['kind']) => {
    switch (kind) {
      case 'inning': return 'text-amber-300';
      case 'ab': return 'text-zinc-100 font-semibold';
      case 'pitch': return 'text-zinc-400';
      case 'play': return 'text-zinc-100';
      case 'score': return 'text-green-300 font-semibold';
      case 'final': return 'text-amber-200 font-bold';
    }
  };

  return (
    <section className="bg-zinc-900 border border-zinc-800 rounded-lg p-3 flex flex-col" style={{ height: 600 }}>
      <h2 className="text-xs uppercase tracking-wider text-zinc-500 mb-2">Play-by-Play</h2>
      <div ref={listRef} className="flex-1 overflow-y-auto font-mono text-xs leading-snug pr-1">
        {visible.map((e, i) => {
          const active = i === lastIdx;
          return (
            <div
              key={`${e.eventIdx}-${i}`}
              data-pbp-active={active ? 'true' : 'false'}
              className={`whitespace-pre-wrap py-0.5 px-1 rounded ${colorFor(e.kind)} ${active ? 'bg-zinc-800/70' : ''}`}
            >
              {e.text}
            </div>
          );
        })}
        {visible.length === 0 && (
          <div className="text-zinc-500">Waiting for first pitch…</div>
        )}
      </div>
    </section>
  );
}
