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
  simulateFullGame,
  MANAGER_PROFILES,
  type PbpEntry,
  type FullGameResult,
  type StrategicLogEntry,
  type ManagerProfile,
  type WorldSnapshot,
  type TickEvent,
} from '@baseballczar/tick-engine';
import {
  createRng,
  generateMatchup,
  simulateGame,
  buildBoxScore,
  type GameResult,
  type Player,
  type Team,
  type Position,
  type BoxScore,
} from '@baseballczar/sim-engine';
import dynamic from 'next/dynamic';

const TickFieldCanvas = dynamic(
  () => import('@/components/sim-v2-tick/TickFieldCanvas'),
  { ssr: false },
);

/** Display-friendly position labels. */
const POS_LABEL: Record<string, string> = {
  P: 'P', C: 'C', B1: '1B', B2: '2B', SS: 'SS', B3: '3B',
  LF: 'LF', CF: 'CF', RF: 'RF', DH: 'DH',
};

interface SimRun {
  seed: number;
  result: GameResult;
  home: Team;
  away: Team;
  fullGame: FullGameResult;
}

function runSim(
  seed: number,
  homeProfile: ManagerProfile,
  awayProfile: ManagerProfile,
): SimRun {
  const rng = createRng(seed);
  const { home, away } = generateMatchup(rng);
  const result = simulateGame(home, away, rng);

  const fullGame = simulateFullGame(result, home, away, {
    homeProfile,
    awayProfile,
    captureEvery: 3,
  });

  return { seed, result, home, away, fullGame };
}

const PROFILE_KEYS = Object.keys(MANAGER_PROFILES);
const PROFILE_ICONS: Record<string, string> = {
  balanced: '⚖️',
  aggressive: '🔥',
  conservative: '🛡️',
  analytics: '📊',
};

export default function SimLab2Page() {
  const [seed, setSeed] = useState<number>(1);
  const [pinned, setPinned] = useState<number>(0);  // 0 = not yet started

  const [sim, setSim] = useState<SimRun | null>(null);
  const [simulating, setSimulating] = useState(false);
  const [pbpEntries, setPbpEntries] = useState<PbpEntry[]>([]);
  const [homeProfileKey, setHomeProfileKey] = useState('balanced');
  const [awayProfileKey, setAwayProfileKey] = useState('balanced');

  // Set a random seed on load but don't auto-run — user clicks Run
  useEffect(() => {
    setSeed(Math.floor(Math.random() * 100000));
  }, []);

  // Run simulation asynchronously so the page renders immediately
  useEffect(() => {
    if (pinned === 0) return;  // Don't run until user clicks Run/Random
    setSimulating(true);
    setSim(null);
    // Yield to browser so the loading state renders before we block
    const timer = setTimeout(() => {
      const result = runSim(pinned, MANAGER_PROFILES[homeProfileKey], MANAGER_PROFILES[awayProfileKey]);
      setSim(result);
      setSimulating(false);
    }, 50);
    return () => clearTimeout(timer);
  }, [pinned, homeProfileKey, awayProfileKey]);

  const handleEvent = useCallback((evts: TickEvent[], time: number) => {
    if (evts.length > 0) {
      const formatted = formatTickEvents(evts, time);
      if (formatted.length > 0) {
        setPbpEntries(prev => [...prev, ...formatted].slice(-200));
      }
    }
  }, []);

  // Auto-scroll PBP to bottom (inside its own container, not the page)
  const pbpScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = pbpScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [pbpEntries]);

  // Reset PBP when seed changes
  useEffect(() => { setPbpEntries([]); }, [pinned]);

  // Accordion panel states
  const [pbpOpen, setPbpOpen] = useState(true);
  const [engineOpen, setEngineOpen] = useState(false);
  const [stratOpen, setStratOpen] = useState(false);
  const [awayRosterOpen, setAwayRosterOpen] = useState(false);
  const [homeRosterOpen, setHomeRosterOpen] = useState(false);
  const [boxScoreOpen, setBoxScoreOpen] = useState(false);

  // Memoize box score from game result
  const boxScore = useMemo<BoxScore | null>(() => {
    if (!sim) return null;
    return buildBoxScore(sim.result);
  }, [sim]);

  return (
    <main className="h-screen bg-zinc-950 text-zinc-100 flex flex-col overflow-hidden">
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

            {/* Manager profiles */}
            <div className="flex items-center gap-2 ml-4 text-sm">
              <span className="text-zinc-400">Mgr:</span>
              <div className="flex items-center gap-1">
                <span className="text-zinc-500 text-xs">Away</span>
                {PROFILE_KEYS.map(k => (
                  <button
                    key={`a-${k}`}
                    onClick={() => setAwayProfileKey(k)}
                    title={MANAGER_PROFILES[k].name}
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
                    title={MANAGER_PROFILES[k].name}
                    className={`px-1.5 py-0.5 rounded text-xs ${homeProfileKey === k ? 'bg-green-700 text-white' : 'bg-zinc-800 text-zinc-500 hover:bg-zinc-700'}`}
                  >
                    {PROFILE_ICONS[k]}
                  </button>
                ))}
              </div>
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
              ) : (
                <span className="text-amber-300 animate-pulse">Simulating…</span>
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
                <div className="text-zinc-400 text-lg">Simulating full game…</div>
                <div className="text-zinc-600 text-sm mt-1">Building tick snapshots for all at-bats</div>
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

                {/* ── Engine Info (accordion) ── */}
                <section className="bg-zinc-900 border border-zinc-800 rounded-lg flex-shrink-0">
                  <button
                    onClick={() => setEngineOpen(!engineOpen)}
                    className="flex items-center justify-between w-full px-3 py-2 text-left hover:bg-zinc-800/50 rounded-t-lg transition-colors"
                  >
                    <h2 className="text-xs uppercase tracking-wider text-zinc-500">Engine Info</h2>
                    <svg
                      className={`w-4 h-4 text-zinc-500 transition-transform duration-200 ${engineOpen ? 'rotate-180' : ''}`}
                      fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {engineOpen && (
                    <div className="px-3 pb-3">
                      <div className="flex justify-between text-sm py-0.5">
                        <span className="text-zinc-400">Total snapshots</span>
                        <span className="font-mono tabular-nums">{sim.fullGame.totalSnapshots}</span>
                      </div>
                      <div className="flex justify-between text-sm py-0.5">
                        <span className="text-zinc-400">Sim duration</span>
                        <span className="font-mono tabular-nums">{sim.fullGame.totalDurationSec.toFixed(1)}s</span>
                      </div>
                      <div className="flex justify-between text-sm py-0.5">
                        <span className="text-zinc-400">At-bats simulated</span>
                        <span className="font-mono tabular-nums">{sim.fullGame.totalAtBats}</span>
                      </div>
                      <div className="flex justify-between text-sm py-0.5">
                        <span className="text-zinc-400">Architecture</span>
                        <span className="font-mono text-xs text-amber-300">Tick @ 60 tps → 30 fps capture</span>
                      </div>
                      <div className="flex justify-between text-sm py-0.5">
                        <span className="text-zinc-400">Collision</span>
                        <span className="font-mono text-xs text-green-300">Colliders + Raycast + Walls</span>
                      </div>
                      <div className="flex justify-between text-sm py-0.5">
                        <span className="text-zinc-400">Surfaces</span>
                        <span className="font-mono text-xs text-blue-300">Dirt (9 ft/s²) / Grass (14 ft/s²)</span>
                      </div>
                      <div className="flex justify-between text-sm py-0.5">
                        <span className="text-zinc-400">AI Manager</span>
                        <span className="font-mono text-xs text-cyan-300">All 3 Tiers Active</span>
                      </div>
                      <div className="flex justify-between text-sm py-0.5">
                        <span className="text-zinc-400">Home Manager</span>
                        <span className="font-mono text-xs text-green-300">{PROFILE_ICONS[homeProfileKey]} {MANAGER_PROFILES[homeProfileKey].name}</span>
                      </div>
                      <div className="flex justify-between text-sm py-0.5">
                        <span className="text-zinc-400">Away Manager</span>
                        <span className="font-mono text-xs text-blue-300">{PROFILE_ICONS[awayProfileKey]} {MANAGER_PROFILES[awayProfileKey].name}</span>
                      </div>
                    </div>
                  )}
                </section>

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
                        {sim.fullGame.strategicLog.map((entry, i) => (
                          <div
                            key={i}
                            className={`py-0.5 px-1 rounded ${
                              entry.type === 'pitching-change' ? 'text-red-300' :
                              entry.type === 'defensive-shift' ? 'text-orange-300' :
                              entry.type === 'pinch-hit' || entry.type === 'pinch-run' ? 'text-emerald-300' :
                              'text-cyan-300'
                            }`}
                          >
                            {entry.half === 'top' ? 'T' : 'B'}{entry.inning} [{entry.team}] {entry.detail}
                          </div>
                        ))}
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

