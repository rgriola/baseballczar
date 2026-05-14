// Last touched by agent: 2026-05-07T23:55:00Z
// Purpose: Replays persisted game events without running a new simulation.
'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import TickFieldCanvas from '@/components/sim-v2-tick/TickFieldCanvas';
import {
  formatTickEvents,
  createPbpState,
  type PbpEntry,
} from '@baseballczar/tick-engine/formatPbp';
import type { TickEvent } from '@baseballczar/tick-engine';
import type { DebugPlayerLookup } from '@/components/sim-v2-tick/tickScene';
import {
  buildPersistedSnapshots,
  num,
  type PersistedGamePayload,
  type PersistedHittingRow,
  type PersistedPitchingRow,
  type PersistedPlayerName,
} from './persisted-replay-data';
import { canResimulate, resimulateForReplay, type ResimPayload } from './persisted-replay-resim';

type ViewMode = 'box' | 'replay';

function resolvePlayerName(
  players: PersistedPlayerName | PersistedPlayerName[] | null | undefined,
): PersistedPlayerName | null {
  if (!players) return null;
  return Array.isArray(players) ? (players[0] ?? null) : players;
}

function shortPlayerName(
  players: PersistedPlayerName | PersistedPlayerName[] | null | undefined,
  fallback: string,
): string {
  const person = resolvePlayerName(players);
  if (!person) return fallback;
  const last = person.last_name?.trim();
  if (!last) return fallback;
  const jersey = person.jersey_no != null ? `#${String(person.jersey_no).padStart(2, '0')} ` : '';
  return `${jersey}${last}`;
}

function lastNonZeroInning(lines: number[]): number {
  for (let i = lines.length; i >= 1; i -= 1) {
    if (num(lines[i - 1], 0) !== 0) return i;
  }
  return 0;
}

export default function PersistedReplay({
  gameId,
  initialView = 'replay',
}: {
  gameId: number;
  initialView?: ViewMode;
}) {
  const [payload, setPayload] = useState<PersistedGamePayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [resimulating, setResimulating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pbpEntries, setPbpEntries] = useState<PbpEntry[]>([]);
  const [pbpOpen, setPbpOpen] = useState(true);
  const [boxOpen, setBoxOpen] = useState(initialView === 'box');
  const [showDebugTags, setShowDebugTags] = useState(false);
  const [debugBallCoords, setDebugBallCoords] = useState(false);
  const pbpScrollRef = useRef<HTMLDivElement>(null);
  const pbpStateRef = useRef(createPbpState());

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setLoading(true);
      setError(null);
      setPbpEntries([]);

      try {
        const res = await fetch(`/api/games/${gameId}`, { cache: 'no-store' });
        const json = await res.json();
        if (!res.ok) {
          throw new Error(json?.error || 'Failed to load persisted game.');
        }
        if (!cancelled) {
          setPayload(json as PersistedGamePayload);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load replay data.');
          setPayload(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    load();
    return () => {
      cancelled = true;
    };
  }, [gameId]);

  // D key toggles debug player tags, B key toggles ball coordinates
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const key = e.key.toLowerCase();
      if (key !== 'd' && key !== 'b') return;
      // Don't toggle if user is typing in an input
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (key === 'd') setShowDebugTags(prev => !prev);
      if (key === 'b') setDebugBallCoords(prev => !prev);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Build debug player lookup from payload (jersey# + last name)
  const playerLookup = useMemo<DebugPlayerLookup>(() => {
    if (!payload) return {};
    const lookup: DebugPlayerLookup = {};
    const addPlayer = (pid: number, p: PersistedPlayerName | PersistedPlayerName[] | null | undefined) => {
      const info = resolvePlayerName(p);
      if (!info) return;
      lookup[pid] = {
        lastName: info.last_name?.trim() ?? '',
        position: info.position ?? '',
        jerseyNumber: info.jersey_no ?? 0,
      };
    };
    for (const h of payload.hitting) addPlayer(h.player_id, h.players);
    for (const p of payload.pitching) addPlayer(p.player_id, p.players);
    return lookup;
  }, [payload]);

  // Re-simulation runs synchronously but can take 1-2s for a full game.
  // We use a separate state to show a loading indicator during computation.
  const replay = useMemo(() => {
    if (!payload) return null;

    // Diagnostic: check what data is available for resim
    const hasSeed = payload.game?.sim_seed != null;
    const gameRow = payload.game as Record<string, unknown> | undefined;
    const hasHomeSnap = gameRow?.['home_roster_snapshot'] != null;
    const hasVisitorSnap = gameRow?.['visitor_roster_snapshot'] != null;
    console.log('[Replay] Seed:', hasSeed, '| HomeSnap:', hasHomeSnap, '| VisitorSnap:', hasVisitorSnap);

    // Use tick engine re-simulation if roster snapshots are available
    if (canResimulate(payload as unknown as ResimPayload)) {
      try {
        console.log('[Replay] ✅ Using TICK ENGINE re-simulation (30fps physics)');
        setResimulating(true);
        const result = resimulateForReplay(payload as unknown as ResimPayload);
        console.log('[Replay] Resim complete:', result.snapshots.length, 'snapshots,', result.totalDurationSec.toFixed(1), 'sec');
        setResimulating(false);
        return result;
      } catch (err) {
        console.warn('[Replay] Resim failed, falling back to reconstruction:', err);
        setResimulating(false);
      }
    } else {
      console.log('[Replay] ⚠️ Falling back to legacy reconstruction (no snapshots)');
    }

    // Fallback for legacy games without roster snapshots
    return buildPersistedSnapshots(payload);
  }, [payload]);

  const onEvent = useCallback((events: TickEvent[], time: number) => {
    if (!events.length) return;
    const formatted = formatTickEvents(events, time, showDebugTags, pbpStateRef.current, debugBallCoords);
    if (!formatted.length) return;
    setPbpEntries((prev) => {
      const next = [...prev];
      for (const entry of formatted) {
        const last = next[next.length - 1];
        const repeatedLanding = Boolean(
          last
          && last.text === entry.text
          && last.text.includes('ball landed')
          && entry.text.includes('ball landed'),
        );
        if (!repeatedLanding) {
          next.push(entry);
        }
      }
      return next.slice(-500);
    });
  }, [showDebugTags, debugBallCoords]);

  useEffect(() => {
    const el = pbpScrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [pbpEntries]);

  const awayName = payload ? payload.teamMap[String(payload.game.visitor_team_id)] ?? 'Away' : 'Away';
  const homeName = payload ? payload.teamMap[String(payload.game.home_team_id)] ?? 'Home' : 'Home';

  const awayLines = payload?.game.visitor_linescore ?? [];
  const homeLines = payload?.game.home_linescore ?? [];
  const persistedInnings = payload ? num(payload.game.innings, 0) : 0;
  const innings = Math.max(
    9,
    persistedInnings,
    lastNonZeroInning(awayLines),
    lastNonZeroInning(homeLines),
  );
  const inningCols = Array.from({ length: innings }, (_, i) => i + 1);
  const awayErrors = payload ? num(payload.game.visitor_errors, 0) : 0;
  const homeErrors = payload ? num(payload.game.home_errors, 0) : 0;
  const simVersion = payload?.game.sim_version?.trim() || 'legacy';
  const simConfigVersion = payload?.game.sim_config_version?.trim() || 'unknown';
  const simSeed = payload?.game.sim_seed;
  const simSeedLabel = typeof simSeed === 'number' && Number.isFinite(simSeed)
    ? String(Math.trunc(simSeed))
    : 'n/a';

  const awayHitting = useMemo(() => {
    if (!payload) return [] as PersistedHittingRow[];
    return [...(payload.hitting ?? [])]
      .filter((r) => num(r.team_id) === num(payload.game.visitor_team_id))
      .sort((a, b) => num(a.bat_order) - num(b.bat_order));
  }, [payload]);

  const homeHitting = useMemo(() => {
    if (!payload) return [] as PersistedHittingRow[];
    return [...(payload.hitting ?? [])]
      .filter((r) => num(r.team_id) === num(payload.game.home_team_id))
      .sort((a, b) => num(a.bat_order) - num(b.bat_order));
  }, [payload]);

  const awayPitching = useMemo(() => {
    if (!payload) return [] as PersistedPitchingRow[];
    return [...(payload.pitching ?? [])]
      .filter((r) => num(r.team_id) === num(payload.game.visitor_team_id))
      .sort((a, b) => num(a.pitch_app) - num(b.pitch_app));
  }, [payload]);

  const homePitching = useMemo(() => {
    if (!payload) return [] as PersistedPitchingRow[];
    return [...(payload.pitching ?? [])]
      .filter((r) => num(r.team_id) === num(payload.game.home_team_id))
      .sort((a, b) => num(a.pitch_app) - num(b.pitch_app));
  }, [payload]);

  const scrollbarClass = '[scrollbar-width:thin] [scrollbar-color:#52525b_#18181b] [&::-webkit-scrollbar]:h-1.5 [&::-webkit-scrollbar]:w-1.5 [&::-webkit-scrollbar-track]:bg-zinc-900/70 [&::-webkit-scrollbar-thumb]:rounded-full [&::-webkit-scrollbar-thumb]:bg-zinc-600/70 [&::-webkit-scrollbar-thumb:hover]:bg-zinc-500/80';

  if (loading || resimulating) {
    return (
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-5 text-sm text-zinc-300 flex items-center gap-3">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-600 border-t-blue-400" />
        {resimulating
          ? 'Generating replay physics...'
          : 'Loading game data...'}
      </div>
    );
  }

  if (error || !payload || !replay) {
    return (
      <div className="space-y-3 rounded-lg border border-red-800/40 bg-red-950/20 px-4 py-4 text-sm text-red-200">
        <p>{error ?? 'Replay data is unavailable.'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-zinc-800 bg-zinc-900/60 px-4 py-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-zinc-500">Replay Source</p>
          <p className="text-sm text-zinc-200">Persisted game events and stored box score</p>
          <p className="mt-1 text-xs text-zinc-500">Sim {simVersion} • Config {simConfigVersion} • Seed {simSeedLabel}</p>
        </div>
        <div className="rounded border border-zinc-700 bg-zinc-950 px-3 py-1.5 text-xs text-zinc-300">
          Duration {replay.totalDurationSec.toFixed(1)}s • {payload.events.length} events
        </div>
      </div>

      <div className="flex gap-4">
        <div className="flex-shrink-0">
          <TickFieldCanvas
            snapshots={replay.snapshots}
            autoplay
            speed={1}
            onEvent={onEvent}
            debugPlayerTags={showDebugTags}
            playerLookup={playerLookup}
          />
        </div>

        <aside className="flex-1 min-w-0 space-y-2">
          <section className="rounded-lg border border-zinc-800 bg-zinc-900">
            <button
              onClick={() => setPbpOpen((prev) => !prev)}
              className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-zinc-800/40"
            >
              <h2 className="text-xs uppercase tracking-wider text-zinc-500">Play-by-Play</h2>
              <span className="text-xs text-zinc-500">{pbpOpen ? 'Hide' : 'Show'}</span>
            </button>
            {pbpOpen && (
              <div
                ref={pbpScrollRef}
                className={`max-h-[360px] overflow-y-auto px-3 pb-3 font-mono text-xs leading-relaxed ${scrollbarClass}`}
              >
                {pbpEntries.length === 0 ? (
                  <div className="text-zinc-500">Press Play to step through persisted events.</div>
                ) : (
                  pbpEntries.map((entry, idx) => (
                    <div
                      key={`${entry.time}-${idx}`}
                      className={`px-1 py-0.5 ${entry.color} ${entry.bold ? 'font-bold' : ''}`}
                    >
                      {entry.text}
                    </div>
                  ))
                )}
              </div>
            )}
          </section>

          <section className="rounded-lg border border-zinc-800 bg-zinc-900">
            <button
              onClick={() => setBoxOpen((prev) => !prev)}
              className="flex w-full items-center justify-between px-3 py-2 text-left hover:bg-zinc-800/40"
            >
              <h2 className="text-xs uppercase tracking-wider text-amber-400">Box Score</h2>
              <span className="text-xs text-zinc-500">{boxOpen ? 'Hide' : 'Show'}</span>
            </button>

            {boxOpen && (
              <div className={`max-h-[500px] space-y-4 overflow-y-auto px-3 pb-3 ${scrollbarClass}`}>
                <div className={`overflow-x-auto ${scrollbarClass}`}>
                  <table className="w-full text-xs font-mono">
                    <thead>
                      <tr className="border-b border-zinc-700 text-zinc-500">
                        <th className="px-1 py-1 text-left">Team</th>
                        {inningCols.map((inn) => (
                          <th key={inn} className="w-6 px-1 py-1 text-center">{inn}</th>
                        ))}
                        <th className="w-8 px-1 py-1 text-center font-bold text-zinc-300">R</th>
                        <th className="w-8 px-1 py-1 text-center font-bold text-zinc-300">H</th>
                        <th className="w-8 px-1 py-1 text-center font-bold text-zinc-300">E</th>
                      </tr>
                    </thead>
                    <tbody>
                      <tr className="border-b border-zinc-800/60">
                        <td className="px-1 py-1 font-bold text-blue-300">{awayName}</td>
                        {inningCols.map((inn) => (
                          <td key={`a-${inn}`} className="px-1 py-1 text-center text-zinc-300">
                            {num(awayLines[inn - 1], 0)}
                          </td>
                        ))}
                        <td className="px-1 py-1 text-center font-bold text-zinc-100">{num(payload.game.visitor_runs, 0)}</td>
                        <td className="px-1 py-1 text-center font-bold text-zinc-100">{num(payload.game.visitor_hits, 0)}</td>
                        <td className="px-1 py-1 text-center font-bold text-zinc-100">{awayErrors}</td>
                      </tr>
                      <tr>
                        <td className="px-1 py-1 font-bold text-green-300">{homeName}</td>
                        {inningCols.map((inn) => (
                          <td key={`h-${inn}`} className="px-1 py-1 text-center text-zinc-300">
                            {num(homeLines[inn - 1], 0)}
                          </td>
                        ))}
                        <td className="px-1 py-1 text-center font-bold text-zinc-100">{num(payload.game.home_runs, 0)}</td>
                        <td className="px-1 py-1 text-center font-bold text-zinc-100">{num(payload.game.home_hits, 0)}</td>
                        <td className="px-1 py-1 text-center font-bold text-zinc-100">{homeErrors}</td>
                      </tr>
                    </tbody>
                  </table>
                </div>

                {[{ label: awayName, rows: awayHitting, color: 'text-blue-300' }, { label: homeName, rows: homeHitting, color: 'text-green-300' }].map((team) => (
                  <div key={`${team.label}-hit`}>
                    <div className={`mb-1 text-[10px] uppercase tracking-wider ${team.color}`}>{team.label} Batting</div>
                    <div className={`overflow-x-auto ${scrollbarClass}`}>
                      <table className="w-full text-xs font-mono">
                        <thead>
                          <tr className="border-b border-zinc-700 text-zinc-500">
                            <th className="py-0.5 text-left">Player</th>
                            <th className="w-5 py-0.5 text-center">AB</th>
                            <th className="w-4 py-0.5 text-center">R</th>
                            <th className="w-4 py-0.5 text-center">H</th>
                            <th className="w-4 py-0.5 text-center">2B</th>
                            <th className="w-4 py-0.5 text-center">3B</th>
                            <th className="w-4 py-0.5 text-center">HR</th>
                            <th className="w-5 py-0.5 text-center">RBI</th>
                            <th className="w-4 py-0.5 text-center">BB</th>
                            <th className="w-4 py-0.5 text-center">SO</th>
                          </tr>
                        </thead>
                        <tbody>
                          {team.rows.length === 0 ? (
                            <tr>
                              <td colSpan={10} className="py-1 text-center text-zinc-500">
                                No batting box data recorded for this game.
                              </td>
                            </tr>
                          ) : (
                            team.rows.map((row) => {
                              const person = resolvePlayerName(row.players);
                              const pos = person?.position ?? row.position ?? '-';
                              const posDisplay = pos === 'B1' ? '1B' : pos === 'B2' ? '2B' : pos === 'B3' ? '3B' : pos;
                              return (
                                <tr key={row.id} className="border-b border-zinc-800/30 hover:bg-zinc-800/30">
                                  <td className="py-0.5 text-white text-[11px] text-left">
                                    <span className="text-zinc-400">{shortPlayerName(row.players, `#${row.player_id}`).split(' ')[0]}</span>{' '}
                                    {shortPlayerName(row.players, `#${row.player_id}`).split(' ').slice(1).join(' ')}{' '}
                                    <span className="text-zinc-400">{posDisplay}</span>
                                  </td>
                                  <td className="py-0.5 text-center tabular-nums text-white">{num(row.ab)}</td>
                                  <td className={`py-0.5 text-center tabular-nums ${num(row.r) > 0 ? 'text-amber-300' : 'text-white'}`}>{num(row.r)}</td>
                                  <td className={`py-0.5 text-center tabular-nums ${num(row.h) > 0 ? 'text-green-300' : 'text-white'}`}>{num(row.h)}</td>
                                  <td className={`py-0.5 text-center tabular-nums ${num(row.b2) > 0 ? 'text-green-300' : 'text-white'}`}>{num(row.b2)}</td>
                                  <td className={`py-0.5 text-center tabular-nums ${num(row.b3) > 0 ? 'text-green-300' : 'text-white'}`}>{num(row.b3)}</td>
                                  <td className={`py-0.5 text-center tabular-nums ${num(row.hr) > 0 ? 'text-red-300 font-bold' : 'text-white'}`}>{num(row.hr)}</td>
                                  <td className={`py-0.5 text-center tabular-nums ${num(row.rbi) > 0 ? 'text-amber-200' : 'text-white'}`}>{num(row.rbi)}</td>
                                  <td className="py-0.5 text-center tabular-nums text-white">{num(row.bb)}</td>
                                  <td className="py-0.5 text-center tabular-nums text-white">{num(row.so)}</td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}

                {[{ label: awayName, rows: awayPitching, color: 'text-blue-300' }, { label: homeName, rows: homePitching, color: 'text-green-300' }].map((team) => (
                  <div key={`${team.label}-pit`}>
                    <div className={`mb-1 text-[10px] uppercase tracking-wider ${team.color}`}>{team.label} Pitching</div>
                    <div className={`overflow-x-auto ${scrollbarClass}`}>
                      <table className="w-full text-xs font-mono">
                        <thead>
                          <tr className="border-b border-zinc-700 text-zinc-500">
                            <th className="py-0.5 text-left">Pitcher</th>
                            <th className="w-7 py-0.5 text-center">IP</th>
                            <th className="w-5 py-0.5 text-center">H</th>
                            <th className="w-5 py-0.5 text-center">R</th>
                            <th className="w-5 py-0.5 text-center">ER</th>
                            <th className="w-5 py-0.5 text-center">BB</th>
                            <th className="w-5 py-0.5 text-center">SO</th>
                            <th className="w-5 py-0.5 text-center">HR</th>
                          </tr>
                        </thead>
                        <tbody>
                          {team.rows.length === 0 ? (
                            <tr>
                              <td colSpan={8} className="py-1 text-center text-zinc-500">
                                No pitching box data recorded for this game.
                              </td>
                            </tr>
                          ) : (
                            team.rows.map((row) => {
                              const name = shortPlayerName(row.players, `#${row.player_id}`);
                              const parts = name.split(' ');
                              const jerseyPart = parts[0]; // #XX
                              const namePart = parts.slice(1).join(' ');
                              return (
                                <tr key={row.id} className="border-b border-zinc-800/30 hover:bg-zinc-800/30">
                                  <td className="py-0.5 text-white text-[11px] text-left">
                                    <span className="text-zinc-400">{jerseyPart}</span>{' '}{namePart}
                                  </td>
                                  <td className="py-0.5 text-center tabular-nums text-white">{num(row.ip).toFixed(1)}</td>
                                  <td className="py-0.5 text-center tabular-nums text-white">{num(row.h)}</td>
                                  <td className={`py-0.5 text-center tabular-nums ${num(row.r) > 0 ? 'text-red-300' : 'text-white'}`}>{num(row.r)}</td>
                                  <td className={`py-0.5 text-center tabular-nums ${num(row.er) > 0 ? 'text-red-300' : 'text-white'}`}>{num(row.er)}</td>
                                  <td className="py-0.5 text-center tabular-nums text-white">{num(row.bb)}</td>
                                  <td className={`py-0.5 text-center tabular-nums ${num(row.so) > 3 ? 'text-cyan-300' : 'text-white'}`}>{num(row.so)}</td>
                                  <td className="py-0.5 text-center tabular-nums text-white">{num(row.hr)}</td>
                                </tr>
                              );
                            })
                          )}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>

          <div className="rounded-lg border border-zinc-800 bg-zinc-900/60 px-3 py-2 text-xs text-zinc-400">
            This replay is sourced from persisted league data. Standalone experimentation remains available in
            {' '}
            <a href="/sim-lab-2" className="text-blue-300 hover:text-blue-200">
              Sim-Lab-2 sandbox
            </a>
            .
          </div>
        </aside>
      </div>
    </div>
  );
}
