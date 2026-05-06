// Last touched by agent: 2026-05-06T14:06:08Z
// Purpose: Reusable Sim Lab 2 gameplay module for sim routes and dashboard games pages.
'use client';

/**
 * Sim Lab 2 — Tick-Based Game Engine (Phase 5)
 *
 * Full-game simulation with AI Manager personalities.
 * Game outcomes come from pre-rolled simulateGame() dice, then replayed
 * through the tick engine with concurrent entity physics.
 */
import { useEffect, useMemo, useState, useCallback, useRef } from 'react';
import {
  formatTickEvents,
  type PbpEntry,
} from '@baseballczar/tick-engine/formatPbp';
import type { TickEvent } from '@baseballczar/tick-engine/entities';
import {
  buildBoxScore,
  type BoxScore,
} from '@baseballczar/sim-engine/boxScore';
import dynamic from 'next/dynamic';
import type { EventDispatchMeta, DebugPlayerLookup } from '@/components/sim-v2-tick/tickScene';
import type { SimRun } from './sim-run-types';
import type { SimWorkerRequest, SimWorkerResponse } from './worker-protocol';
import { SimLabDiagnosticsPanel } from './components/SimLabDiagnosticsPanel';
import {
  POS_LABEL,
  PROFILE_KEYS,
  PROFILE_LABELS,
  PROFILE_ICONS,
  ROLE_BADGE_CLASS,
  parseRoleTag,
} from './ui-constants';

const TickFieldCanvas = dynamic(
  () => import('@/components/sim-v2-tick/TickFieldCanvas'),
  { ssr: false },
);

interface SimLab2ModuleProps {
  embedded?: boolean;
  initialSeed?: number;
  initialBoxScoreOpen?: boolean;
}

export default function SimLab2Module({
  embedded = false,
  initialSeed,
  initialBoxScoreOpen = false,
}: SimLab2ModuleProps) {
  const [seed, setSeed] = useState<number>(1);
  const [pinned, setPinned] = useState<number>(0);  // 0 = not yet started
  const [runToken, setRunToken] = useState<number>(0);
  const [sim, setSim] = useState<SimRun | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const [pbpEntries, setPbpEntries] = useState<PbpEntry[]>([]);
  const [debugPbp, setDebugPbp] = useState(false);
  const [homeProfileKey, setHomeProfileKey] = useState<(typeof PROFILE_KEYS)[number]>('balanced');
  const [awayProfileKey, setAwayProfileKey] = useState<(typeof PROFILE_KEYS)[number]>('balanced');
  const simWorkerRef = useRef<Worker | null>(null);
  const fallbackRunnerImportRef = useRef<Promise<typeof import('./sim-runner')> | null>(null);
  const activeRunRef = useRef<{ requestId: number; startedAt: number; mode: 'worker' | 'fallback' } | null>(null);
  const latestRequestIdRef = useRef<number>(0);
  const [timingStats, setTimingStats] = useState({ mode: 'none' as 'none' | 'worker' | 'fallback', lastMs: null as number | null, avgMs: null as number | null, samples: 0, cancelled: 0 });

  const finalizeRunTiming = useCallback((requestId: number) => {
    const active = activeRunRef.current;
    if (!active || active.requestId !== requestId) return;
    const elapsed = performance.now() - active.startedAt;
    setTimingStats((prev) => {
      const samples = prev.samples + 1;
      const avgMs = prev.avgMs === null ? elapsed : ((prev.avgMs * prev.samples) + elapsed) / samples;
      return { ...prev, mode: active.mode, lastMs: elapsed, avgMs, samples };
    });
    activeRunRef.current = null;
  }, []);

  // Set an initial seed but don't auto-run — user clicks Run.
  useEffect(() => {
    if (typeof initialSeed === 'number' && Number.isFinite(initialSeed) && initialSeed > 0) {
      setSeed(initialSeed);
      return;
    }
    setSeed(Math.floor(Math.random() * 100000));
  }, [initialSeed]);

  const getOrCreateWorker = useCallback((): Worker | null => {
    if (typeof Worker === 'undefined') return null;
    if (simWorkerRef.current) return simWorkerRef.current;

    let worker: Worker;
    try {
      worker = new Worker(new URL('./sim-web.worker.ts', import.meta.url), { type: 'module' });
    } catch (error) {
      console.warn('[sim-lab-2] browser worker unavailable; using main-thread fallback', error);
      return null;
    }

    const handleMessage = (event: MessageEvent<SimWorkerResponse>) => {
      const message = event.data;
      if (!message || message.requestId !== latestRequestIdRef.current) return;

      if (message.type === 'success') {
        setSim(message.payload);
        setSimError(null);
      } else {
        setSimError(message.error || 'Simulation failed. Try another seed.');
      }
      finalizeRunTiming(message.requestId);
      setSimulating(false);
    };

    const handleError = (event: ErrorEvent) => {
      console.error('[sim-lab-2] worker execution failed', event.error ?? event.message);
      if (activeRunRef.current?.mode === 'worker') {
        activeRunRef.current = null;
        setTimingStats((prev) => ({ ...prev, cancelled: prev.cancelled + 1 }));
      }
      setSimError('Simulation worker crashed. Falling back to in-page simulation.');
      setSimulating(false);
      if (simWorkerRef.current === worker) {
        simWorkerRef.current = null;
      }
      worker.terminate();
    };

    worker.addEventListener('message', handleMessage);
    worker.addEventListener('error', handleError);
    simWorkerRef.current = worker;
    return worker;
  }, [finalizeRunTiming]);

  useEffect(() => {
    return () => {
      simWorkerRef.current?.terminate();
      simWorkerRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (pinned === 0 || runToken === 0) return;  // Don't run until user clicks Run/Random

    const requestId = runToken;
    latestRequestIdRef.current = requestId;

    if (activeRunRef.current && activeRunRef.current.requestId !== requestId) {
      setTimingStats((prev) => ({ ...prev, cancelled: prev.cancelled + 1 }));
    }

    setSimulating(true);
    setSimError(null);
    setPbpEntries([]);
    setSim(null);
    const startedAt = performance.now();

    let worker = simWorkerRef.current ?? getOrCreateWorker();
    if (worker && activeRunRef.current?.mode === 'worker' && activeRunRef.current.requestId !== requestId) {
      worker.terminate();
      simWorkerRef.current = null;
      worker = getOrCreateWorker();
    }

    if (worker) {
      activeRunRef.current = { requestId, startedAt, mode: 'worker' };
      const request: SimWorkerRequest = {
        type: 'run-sim',
        requestId,
        seed: pinned,
        homeProfileKey,
        awayProfileKey,
      };
      worker.postMessage(request);
      return;
    }

    activeRunRef.current = { requestId, startedAt, mode: 'fallback' };
    let cancelled = false;
    const runFallback = async () => {
      try {
        if (!fallbackRunnerImportRef.current) {
          fallbackRunnerImportRef.current = import('./sim-runner');
        }
        const { runSim } = await fallbackRunnerImportRef.current;
        if (cancelled || latestRequestIdRef.current !== requestId) return;

        const result = runSim(pinned, homeProfileKey, awayProfileKey);
        if (latestRequestIdRef.current !== requestId) return;
        setSim(result);
        setSimError(null);
      } catch (error) {
        if (cancelled || latestRequestIdRef.current !== requestId) return;
        if (latestRequestIdRef.current !== requestId) return;
        console.error('[sim-lab-2] simulation failed', error);
        setSimError('Simulation failed. Try another seed.');
      } finally {
        if (cancelled) return;
        if (latestRequestIdRef.current === requestId) {
          finalizeRunTiming(requestId);
          setSimulating(false);
        }
      }
    };

    void runFallback();

    return () => {
      cancelled = true;
    };
  }, [pinned, runToken, homeProfileKey, awayProfileKey, getOrCreateWorker, finalizeRunTiming]);

  const handleEvent = useCallback((evts: TickEvent[], time: number, meta?: EventDispatchMeta) => {
    if (evts.length > 0) {
      const formatted = formatTickEvents(evts, time);
      const debugEntries: PbpEntry[] = debugPbp && meta ? [{
        time,
        kind: 'flow',
        text: `[DBG] snap=${meta.snapIdx} t=${time.toFixed(2)}s play=${meta.playbackTime.toFixed(2)}s ball=${meta.ballState} f=${meta.fielderCount} r=${meta.runnerCount} events=[${evts.map((evt) => evt.type).join(', ')}]`,
        color: 'text-fuchsia-300',
      }] : [];

      if (formatted.length > 0 || debugEntries.length > 0) {
        setPbpEntries(prev => [...prev, ...debugEntries, ...formatted].slice(-300));
      }
    }
  }, [debugPbp]);

  // Auto-scroll PBP to bottom (inside its own container, not the page)
  const pbpScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = pbpScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [pbpEntries]);

  // Toggle dev debug trace with keyboard shortcut.
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'd') return;
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return;
      event.preventDefault();
      setDebugPbp((prev) => !prev);
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  // Accordion panel states
  const [pbpOpen, setPbpOpen] = useState(true);
  const [stratOpen, setStratOpen] = useState(false);
  const [awayRosterOpen, setAwayRosterOpen] = useState(false);
  const [homeRosterOpen, setHomeRosterOpen] = useState(false);
  const [boxScoreOpen, setBoxScoreOpen] = useState(initialBoxScoreOpen);

  // Memoize box score from game result
  const boxScore = useMemo<BoxScore | null>(() => {
    if (!sim) return null;
    return buildBoxScore(sim.result);
  }, [sim]);

  const debugPlayerLookup = useMemo<DebugPlayerLookup>(() => {
    if (!sim) return {};

    const lookup: DebugPlayerLookup = {};
    const addPlayer = (p: SimRun['home']['roster'][number]) => {
      lookup[p.id] = {
        lastName: p.lastName,
        position: POS_LABEL[p.position] ?? p.position,
      };
    };

    for (const player of sim.home.roster) addPlayer(player);
    for (const player of sim.away.roster) addPlayer(player);

    return lookup;
  }, [sim]);

  return (
    <main className={`bg-zinc-950 text-zinc-100 flex flex-col overflow-hidden ${embedded ? 'h-[85vh] min-h-[840px] rounded-xl border border-zinc-800' : 'h-screen'}`}>
      {/* Fixed header + controls */}
      <div className="flex-shrink-0 px-6 pt-4 pb-2">
        <div className="max-w-[1400px] mx-auto flex flex-col gap-3">
          <header className="flex items-baseline gap-3">
            <h1 className="text-2xl font-bold">
              Sim Lab 2
              <span className="ml-2 text-xs font-normal px-2 py-0.5 rounded bg-amber-900/60 text-amber-300">
                Tick Engine
              </span>
            </h1>
            <span className="text-zinc-500 text-sm">
              Concurrent entity simulation — all players move simultaneously.
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
              onClick={() => {
                setPinned(seed);
                setRunToken((prev) => prev + 1);
              }}
              className={`px-3 py-1.5 rounded text-sm font-medium ${simulating ? 'bg-amber-600 hover:bg-amber-500' : 'bg-blue-600 hover:bg-blue-500'}`}
            >
              {simulating ? 'Restart' : 'Run'}
            </button>
            <button
              onClick={() => {
                const s = Math.floor(Math.random() * 100000);
                setSeed(s);
                setPinned(s);
                setRunToken((prev) => prev + 1);
              }}
              className="px-3 py-1.5 rounded text-sm bg-zinc-700 hover:bg-zinc-600"
            >
              {simulating ? '🎲 Re-roll' : '🎲 Random'}
            </button>

            {/* Manager profiles */}
            <div className="flex items-center gap-2 ml-4 text-sm">
              <span className="text-zinc-400">Mgr:</span>
              <div className="flex items-center gap-1">
                <span className="text-zinc-500 text-xs">Away</span>
                {PROFILE_KEYS.map(k => (
                  <button
                    key={`a-${k}`}
                    onClick={() => setAwayProfileKey(k)}
                    title={PROFILE_LABELS[k]}
                    className={`px-1.5 py-0.5 rounded text-xs ${awayProfileKey === k ? 'bg-blue-700 text-white' : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700'}`}
                  >
                    {PROFILE_ICONS[k]}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1">
                <span className="text-zinc-500 text-xs">Home</span>
                {PROFILE_KEYS.map(k => (
                  <button
                    key={`h-${k}`}
                    onClick={() => setHomeProfileKey(k)}
                    title={PROFILE_LABELS[k]}
                    className={`px-1.5 py-0.5 rounded text-xs ${homeProfileKey === k ? 'bg-green-700 text-white' : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700'}`}
                  >
                    {PROFILE_ICONS[k]}
                  </button>
                ))}
              </div>
            </div>

            <div className={`text-xs px-2 py-1 rounded ${debugPbp ? 'bg-fuchsia-900/60 text-fuchsia-200 border border-fuchsia-700' : 'bg-zinc-800 text-zinc-500 border border-zinc-700'}`}>
              D Debug: {debugPbp ? 'ON' : 'OFF'}
            </div>

            <div className="text-xs px-2 py-1 rounded bg-zinc-800 text-zinc-400 border border-zinc-700 font-mono">
              PERF: {timingStats.lastMs === null
                ? 'no runs'
                : `${timingStats.mode} ${timingStats.lastMs.toFixed(0)}ms avg ${timingStats.avgMs?.toFixed(0)}ms`}
              {timingStats.cancelled > 0 ? ` • cancel ${timingStats.cancelled}` : ''}
            </div>

            <div className="ml-auto flex items-center gap-3 text-sm">
              {sim ? (
                <>
                  <span className="text-zinc-400">
                    {sim.result.awayTeam.name}
                    <span className="text-zinc-600"> @ </span>
                    {sim.result.homeTeam.name}
                  </span>
                  <span className="font-mono font-bold tabular-nums text-lg">
                    {sim.result.awayRuns} – {sim.result.homeRuns}
                  </span>
                </>
              ) : simulating ? (
                <span className="text-amber-300 animate-pulse">Simulating…</span>
              ) : simError ? (
                <span className="text-red-300">{simError}</span>
              ) : (
                <span className="text-zinc-500">Ready</span>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Main content area — fills remaining viewport height */}
      <div className="flex-1 min-h-0 px-6 pb-4">
        <div className="max-w-[1400px] mx-auto h-full">
          {!sim ? (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <div className="text-4xl mb-4 animate-bounce">⚾</div>
                <div className="text-zinc-400 text-lg">
                  {simulating ? 'Simulating full game…' : 'Ready to run simulation'}
                </div>
                <div className="text-zinc-600 text-sm mt-1">
                  {simulating
                    ? 'Building tick snapshots for all at-bats'
                    : simError ?? 'Choose a seed and click Run or Random'}
                </div>
              </div>
            </div>
          ) : (
            <div className="flex gap-4 h-full">
              {/* Field canvas — fixed size */}
              <div className="flex-shrink-0">
                <TickFieldCanvas
                  snapshots={sim.fullGame.snapshots}
                  autoplay={true}
                  speed={1}
                  onEvent={handleEvent}
                  debugPlayerTags={debugPbp}
                  playerLookup={debugPlayerLookup}
                />
              </div>

              {/* Sidebar — fills height, internal scroll */}
              <aside className="flex-1 min-w-0 flex flex-col gap-2 overflow-y-auto">

                {/* ── Play-by-Play (accordion) ── */}
                <section className="bg-zinc-900 border border-zinc-800 rounded-lg flex flex-col flex-shrink-0">
                  <button
                    onClick={() => setPbpOpen(!pbpOpen)}
                    className="flex items-center justify-between w-full px-3 py-2 text-left hover:bg-zinc-800/50 rounded-t-lg transition-colors"
                  >
                    <h2 className="text-xs uppercase tracking-wider text-zinc-500">
                      Play-by-Play
                    </h2>
                    <svg
                      className={`w-4 h-4 text-zinc-500 transition-transform duration-200 ${pbpOpen ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {pbpOpen && (
                    <div
                      ref={pbpScrollRef}
                      className="overflow-y-auto font-mono text-xs leading-relaxed px-3 pb-3"
                      style={{ maxHeight: 340 }}
                    >
                      {pbpEntries.length === 0 ? (
                        <div className="text-zinc-500">Waiting for first pitch…</div>
                      ) : (
                        pbpEntries.map((entry, i) => (
                          <div
                            key={i}
                            className={`py-0.5 px-1 rounded ${entry.color} ${entry.bold ? 'font-bold' : ''} ${
                              entry.kind === 'inning' ? 'mt-3 mb-1 text-center' :
                              entry.kind === 'ab-header' ? 'mt-2' :
                              entry.kind === 'result' ? 'mt-1 mb-1' :
                              ''
                            }`}
                          >
                            {entry.text}
                          </div>
                        ))
                      )}
                    </div>
                  )}
                </section>

                <SimLabDiagnosticsPanel
                  sim={sim}
                  timingStats={timingStats}
                  homeProfileKey={homeProfileKey}
                  awayProfileKey={awayProfileKey}
                  profileIcons={PROFILE_ICONS}
                  runToken={runToken}
                  latestRequestId={latestRequestIdRef.current}
                  seed={seed}
                  pinned={pinned}
                  simulating={simulating}
                  simError={simError}
                  workerReady={Boolean(simWorkerRef.current)}
                  debugPbp={debugPbp}
                  pbpCount={pbpEntries.length}
                />

                {/* ── Strategic Decisions (accordion) ── */}
                {sim.fullGame.strategicLog.length > 0 && (
                  <section className="bg-zinc-900 border border-zinc-800 rounded-lg flex-shrink-0">
                    <button
                      onClick={() => setStratOpen(!stratOpen)}
                      className="flex items-center justify-between w-full px-3 py-2 text-left hover:bg-zinc-800/50 rounded-t-lg transition-colors"
                    >
                      <h2 className="text-xs uppercase tracking-wider text-zinc-500">
                        Strategic Decisions ({sim.fullGame.strategicLog.length})
                      </h2>
                      <svg
                        className={`w-4 h-4 text-zinc-500 transition-transform duration-200 ${stratOpen ? 'rotate-180' : ''}`}
                        fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                      >
                        <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                      </svg>
                    </button>
                    {stratOpen && (
                      <div className="max-h-40 overflow-y-auto font-mono text-xs leading-snug px-3 pb-3">
                        {sim.fullGame.strategicLog.map((entry, i) => {
                          const parsed = parseRoleTag(entry.detail);
                          const roleClass = parsed.role
                            ? ROLE_BADGE_CLASS[parsed.role] ?? 'text-zinc-200 bg-zinc-800 border-zinc-600'
                            : null;

                          return (
                            <div
                              key={i}
                              className={`py-0.5 px-1 rounded ${
                                entry.type === 'pitching-change' ? 'text-red-300' :
                                entry.type === 'defensive-shift' ? 'text-orange-300' :
                                entry.type === 'pinch-hit' || entry.type === 'pinch-run' ? 'text-emerald-300' :
                                'text-cyan-300'
                              }`}
                            >
                              {entry.half === 'top' ? 'T' : 'B'}{entry.inning} [{entry.team}] {' '}
                              {parsed.role && (
                                <span className={`inline-flex items-center px-1 py-[1px] mr-1 text-[10px] font-bold rounded border ${roleClass}`}>
                                  {parsed.role}
                                </span>
                              )}
                              {parsed.text}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </section>
                )}

                {/* ── Box Score (accordion) ── */}
                <section className="bg-zinc-900 border border-zinc-800 rounded-lg flex-shrink-0">
                  <button
                    onClick={() => setBoxScoreOpen(!boxScoreOpen)}
                    className="flex items-center justify-between w-full px-3 py-2 text-left hover:bg-zinc-800/50 rounded-t-lg transition-colors"
                  >
                    <h2 className="text-xs uppercase tracking-wider text-amber-400">📊 Box Score</h2>
                    <svg className={`w-4 h-4 text-zinc-500 transition-transform duration-200 ${boxScoreOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                  </button>
                  {boxScoreOpen && boxScore && (
                    <div className="px-3 pb-3 max-h-[500px] overflow-y-auto">
                      {/* Linescore */}
                      <div className="mb-3 overflow-x-auto">
                        <table className="w-full text-xs font-mono">
                          <thead>
                            <tr className="text-zinc-500 border-b border-zinc-700">
                              <th className="text-left py-1 px-1 font-medium w-16">Team</th>
                              {boxScore.away.innings.map((_, i) => (
                                <th key={i} className="text-center py-1 px-1 font-medium w-6">{i + 1}</th>
                              ))}
                              <th className="text-center py-1 px-1 font-bold text-zinc-300 w-8">R</th>
                              <th className="text-center py-1 px-1 font-bold text-zinc-300 w-8">H</th>
                              <th className="text-center py-1 px-1 font-bold text-zinc-300 w-8">E</th>
                            </tr>
                          </thead>
                          <tbody>
                            {[boxScore.away, boxScore.home].map((team, ti) => (
                              <tr key={ti} className="border-b border-zinc-800/50">
                                <td className={`py-1 px-1 font-bold ${ti === 0 ? 'text-blue-300' : 'text-green-300'}`}>{team.teamAbbrev}</td>
                                {team.innings.map((r, i) => (
                                  <td key={i} className={`text-center py-1 px-1 ${r > 0 ? 'text-amber-300 font-bold' : 'text-zinc-600'}`}>{r}</td>
                                ))}
                                <td className="text-center py-1 px-1 font-bold text-zinc-100">{team.totalRuns}</td>
                                <td className="text-center py-1 px-1 text-zinc-300">{team.totalHits}</td>
                                <td className="text-center py-1 px-1 text-red-400">{team.totalErrors}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>

                      {/* Batting sections */}
                      {[{ label: 'Away', team: boxScore.away, color: 'text-blue-300' }, { label: 'Home', team: boxScore.home, color: 'text-green-300' }].map(({ label, team, color }) => (
                        <div key={label} className="mb-3">
                          <div className={`text-[10px] uppercase tracking-wider mb-1 ${color}`}>{team.teamName} Batting</div>
                          <table className="w-full text-xs font-mono">
                            <thead>
                              <tr className="text-zinc-500 border-b border-zinc-700">
                                <th className="text-left py-0.5 font-medium">Player</th>
                                <th className="text-center py-0.5 font-medium w-5">Pos</th>
                                <th className="text-center py-0.5 font-medium w-6">AB</th>
                                <th className="text-center py-0.5 font-medium w-5">R</th>
                                <th className="text-center py-0.5 font-medium w-5">H</th>
                                <th className="text-center py-0.5 font-medium w-5">HR</th>
                                <th className="text-center py-0.5 font-medium w-6">RBI</th>
                                <th className="text-center py-0.5 font-medium w-5">BB</th>
                                <th className="text-center py-0.5 font-medium w-5">SO</th>
                              </tr>
                            </thead>
                            <tbody>
                              {team.batters.map(b => (
                                <tr key={b.player.id} className="border-b border-zinc-800/30 hover:bg-zinc-800/30">
                                  <td className="py-0.5 text-zinc-200 text-[11px]">{b.player.firstName[0]}. {b.player.lastName}</td>
                                  <td className="text-center py-0.5 text-zinc-500">{b.posLabel}</td>
                                  <td className="text-center py-0.5 tabular-nums">{b.ab}</td>
                                  <td className={`text-center py-0.5 tabular-nums ${b.runs > 0 ? 'text-amber-300' : ''}`}>{b.runs}</td>
                                  <td className={`text-center py-0.5 tabular-nums ${b.hits > 0 ? 'text-green-300' : ''}`}>{b.hits}</td>
                                  <td className={`text-center py-0.5 tabular-nums ${b.homeRuns > 0 ? 'text-red-300 font-bold' : ''}`}>{b.homeRuns}</td>
                                  <td className={`text-center py-0.5 tabular-nums ${b.rbis > 0 ? 'text-amber-200' : ''}`}>{b.rbis}</td>
                                  <td className="text-center py-0.5 tabular-nums text-zinc-400">{b.walks}</td>
                                  <td className="text-center py-0.5 tabular-nums text-zinc-500">{b.strikeouts}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ))}

                      {/* Pitching sections */}
                      {[{ label: 'Away', team: boxScore.away, color: 'text-blue-300' }, { label: 'Home', team: boxScore.home, color: 'text-green-300' }].map(({ label, team, color }) => (
                        <div key={label} className="mb-3">
                          <div className={`text-[10px] uppercase tracking-wider mb-1 ${color}`}>{team.teamName} Pitching</div>
                          <table className="w-full text-xs font-mono">
                            <thead>
                              <tr className="text-zinc-500 border-b border-zinc-700">
                                <th className="text-left py-0.5 font-medium">Pitcher</th>
                                <th className="text-center py-0.5 font-medium w-7">IP</th>
                                <th className="text-center py-0.5 font-medium w-5">H</th>
                                <th className="text-center py-0.5 font-medium w-5">R</th>
                                <th className="text-center py-0.5 font-medium w-5">BB</th>
                                <th className="text-center py-0.5 font-medium w-5">SO</th>
                                <th className="text-center py-0.5 font-medium w-5">HR</th>
                                <th className="text-center py-0.5 font-medium w-6">PC</th>
                              </tr>
                            </thead>
                            <tbody>
                              {team.pitchers.map(p => (
                                <tr key={p.player.id} className="border-b border-zinc-800/30 hover:bg-zinc-800/30">
                                  <td className="py-0.5 text-zinc-200 text-[11px]">{p.player.firstName[0]}. {p.player.lastName}</td>
                                  <td className="text-center py-0.5 tabular-nums">{p.ip}</td>
                                  <td className="text-center py-0.5 tabular-nums">{p.hits}</td>
                                  <td className={`text-center py-0.5 tabular-nums ${p.runs > 0 ? 'text-red-300' : ''}`}>{p.runs}</td>
                                  <td className="text-center py-0.5 tabular-nums text-zinc-400">{p.walks}</td>
                                  <td className={`text-center py-0.5 tabular-nums ${p.strikeouts > 3 ? 'text-cyan-300' : ''}`}>{p.strikeouts}</td>
                                  <td className="text-center py-0.5 tabular-nums">{p.homeRuns}</td>
                                  <td className="text-center py-0.5 tabular-nums text-zinc-500">{p.pitches}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ))}
                    </div>
                  )}
                </section>

                {/* ── Away Roster (accordion) ── */}
                <section className="bg-zinc-900 border border-zinc-800 rounded-lg flex-shrink-0">
                  <button onClick={() => setAwayRosterOpen(!awayRosterOpen)} className="flex items-center justify-between w-full px-3 py-2 text-left hover:bg-zinc-800/50 rounded-t-lg transition-colors">
                    <h2 className="text-xs uppercase tracking-wider text-zinc-500">Away — {sim.away.name}</h2>
                    <svg className={`w-4 h-4 text-zinc-500 transition-transform duration-200 ${awayRosterOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                  </button>
                  {awayRosterOpen && (
                    <div className="px-3 pb-3 max-h-80 overflow-y-auto">
                      <table className="w-full text-[10px] font-mono">
                        <thead>
                          <tr className="text-zinc-500 border-b border-zinc-800">
                            <th className="text-left py-1">#</th>
                            <th className="text-left py-1">Player</th>
                            <th className="text-center py-1">Pos</th>
                            <th className="text-center py-1">B</th>
                            <th className="text-center py-1 text-green-400">SPD</th>
                            <th className="text-center py-1 text-purple-400">AG</th>
                            <th className="text-center py-1 text-yellow-500">STM</th>
                            <th className="text-center py-1 text-cyan-400">EYE</th>
                            <th className="text-center py-1 text-amber-500">AVG</th>
                            <th className="text-center py-1 text-red-400">PWR</th>
                            <th className="text-center py-1 text-blue-400">FLD</th>
                            <th className="text-center py-1 text-pink-400">TH</th>
                            <th className="text-center py-1 text-zinc-500">PI</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sim.away.lineup.map((p, i) => {
                            const gs = sim.result.batterStats.get(p.id);
                            return (
                              <tr key={p.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                                <td className="py-0.5 text-zinc-600">{i + 1}</td>
                                <td className="py-0.5 text-zinc-200 text-[11px]">{p.firstName[0]}. {p.lastName}</td>
                                <td className="py-0.5 text-center text-blue-300">{POS_LABEL[p.position] ?? p.position}</td>
                                <td className="py-0.5 text-center text-zinc-500">{p.hand}</td>
                                <td className="py-0.5 text-center text-green-400">{p.skills.speed}</td>
                                <td className="py-0.5 text-center text-purple-400">{p.skills.ag}</td>
                                <td className="py-0.5 text-center text-yellow-500">{p.skills.stamina}</td>
                                <td className="py-0.5 text-center text-cyan-400">{p.skills.eye}</td>
                                <td className="py-0.5 text-center text-amber-500">{p.skills.avg}</td>
                                <td className="py-0.5 text-center text-red-400">{p.skills.power}</td>
                                <td className="py-0.5 text-center text-blue-400">{p.skills.fielding}</td>
                                <td className="py-0.5 text-center text-pink-400">{p.skills.throwing}</td>
                                <td className="py-0.5 text-center text-zinc-600">{p.skills.playIntelligence}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {sim.away.bullpen.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-zinc-800">
                          <div className="text-zinc-600 text-[10px] uppercase tracking-wider mb-1">Bullpen</div>
                          <table className="w-full text-[10px] font-mono">
                            <tbody>
                              {sim.away.bullpen.map(p => (
                                <tr key={p.id} className="hover:bg-zinc-800/30">
                                  <td className="py-0.5 text-zinc-400">{p.firstName[0]}. {p.lastName}</td>
                                  <td className="py-0.5 text-center text-zinc-600 w-8">STM {p.skills.stamina}</td>
                                  <td className="py-0.5 text-center text-zinc-600 w-8">EYE {p.skills.eye}</td>
                                  <td className="py-0.5 text-center text-zinc-600 w-8">TH {p.skills.throwing}</td>
                                  <td className="py-0.5 text-center text-zinc-600 w-8">FLD {p.skills.fielding}</td>
                                  <td className="py-0.5 text-center text-zinc-600 w-8">PI {p.skills.playIntelligence}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </section>

                {/* ── Home Roster (accordion) ── */}
                <section className="bg-zinc-900 border border-zinc-800 rounded-lg flex-shrink-0">
                  <button onClick={() => setHomeRosterOpen(!homeRosterOpen)} className="flex items-center justify-between w-full px-3 py-2 text-left hover:bg-zinc-800/50 rounded-t-lg transition-colors">
                    <h2 className="text-xs uppercase tracking-wider text-zinc-500">Home — {sim.home.name}</h2>
                    <svg className={`w-4 h-4 text-zinc-500 transition-transform duration-200 ${homeRosterOpen ? 'rotate-180' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" /></svg>
                  </button>
                  {homeRosterOpen && (
                    <div className="px-3 pb-3 max-h-80 overflow-y-auto">
                      <table className="w-full text-[10px] font-mono">
                        <thead>
                          <tr className="text-zinc-500 border-b border-zinc-800">
                            <th className="text-left py-1">#</th>
                            <th className="text-left py-1">Player</th>
                            <th className="text-center py-1">Pos</th>
                            <th className="text-center py-1">B</th>
                            <th className="text-center py-1 text-green-400">SPD</th>
                            <th className="text-center py-1 text-purple-400">AG</th>
                            <th className="text-center py-1 text-yellow-500">STM</th>
                            <th className="text-center py-1 text-cyan-400">EYE</th>
                            <th className="text-center py-1 text-amber-500">AVG</th>
                            <th className="text-center py-1 text-red-400">PWR</th>
                            <th className="text-center py-1 text-blue-400">FLD</th>
                            <th className="text-center py-1 text-pink-400">TH</th>
                            <th className="text-center py-1 text-zinc-500">PI</th>
                          </tr>
                        </thead>
                        <tbody>
                          {sim.home.lineup.map((p, i) => {
                            const gs = sim.result.batterStats.get(p.id);
                            return (
                              <tr key={p.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                                <td className="py-0.5 text-zinc-600">{i + 1}</td>
                                <td className="py-0.5 text-zinc-200 text-[11px]">{p.firstName[0]}. {p.lastName}</td>
                                <td className="py-0.5 text-center text-green-300">{POS_LABEL[p.position] ?? p.position}</td>
                                <td className="py-0.5 text-center text-zinc-500">{p.hand}</td>
                                <td className="py-0.5 text-center text-green-400">{p.skills.speed}</td>
                                <td className="py-0.5 text-center text-purple-400">{p.skills.ag}</td>
                                <td className="py-0.5 text-center text-yellow-500">{p.skills.stamina}</td>
                                <td className="py-0.5 text-center text-cyan-400">{p.skills.eye}</td>
                                <td className="py-0.5 text-center text-amber-500">{p.skills.avg}</td>
                                <td className="py-0.5 text-center text-red-400">{p.skills.power}</td>
                                <td className="py-0.5 text-center text-blue-400">{p.skills.fielding}</td>
                                <td className="py-0.5 text-center text-pink-400">{p.skills.throwing}</td>
                                <td className="py-0.5 text-center text-zinc-600">{p.skills.playIntelligence}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      {sim.home.bullpen.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-zinc-800">
                          <div className="text-zinc-600 text-[10px] uppercase tracking-wider mb-1">Bullpen</div>
                          <table className="w-full text-[10px] font-mono">
                            <tbody>
                              {sim.home.bullpen.map(p => (
                                <tr key={p.id} className="hover:bg-zinc-800/30">
                                  <td className="py-0.5 text-zinc-400">{p.firstName[0]}. {p.lastName}</td>
                                  <td className="py-0.5 text-center text-zinc-600 w-8">STM {p.skills.stamina}</td>
                                  <td className="py-0.5 text-center text-zinc-600 w-8">EYE {p.skills.eye}</td>
                                  <td className="py-0.5 text-center text-zinc-600 w-8">TH {p.skills.throwing}</td>
                                  <td className="py-0.5 text-center text-zinc-600 w-8">FLD {p.skills.fielding}</td>
                                  <td className="py-0.5 text-center text-zinc-600 w-8">PI {p.skills.playIntelligence}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  )}
                </section>
              </aside>
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

