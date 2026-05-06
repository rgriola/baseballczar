// Last touched by agent: 2026-05-05T18:04:00Z
// Purpose: Renders engine and debug diagnostics for Sim Lab 2 runs.
'use client';

import { useMemo, useState } from 'react';
import type { SimRun } from '../sim-run-types';
import type { ManagerProfileKey } from '../worker-protocol';
import { PROFILE_LABELS } from '../ui-constants';

export interface SimTimingStats {
  mode: 'none' | 'worker' | 'fallback';
  lastMs: number | null;
  avgMs: number | null;
  samples: number;
  cancelled: number;
}

interface SimLabDiagnosticsPanelProps {
  sim: SimRun;
  timingStats: SimTimingStats;
  homeProfileKey: ManagerProfileKey;
  awayProfileKey: ManagerProfileKey;
  profileIcons: Record<string, string>;
  runToken: number;
  latestRequestId: number;
  seed: number;
  pinned: number;
  simulating: boolean;
  simError: string | null;
  workerReady: boolean;
  debugPbp: boolean;
  pbpCount: number;
}

export function SimLabDiagnosticsPanel({
  sim,
  timingStats,
  homeProfileKey,
  awayProfileKey,
  profileIcons,
  runToken,
  latestRequestId,
  seed,
  pinned,
  simulating,
  simError,
  workerReady,
  debugPbp,
  pbpCount,
}: SimLabDiagnosticsPanelProps) {
  const [engineOpen, setEngineOpen] = useState(false);
  const [debugOpen, setDebugOpen] = useState(true);

  const strategicCounts = useMemo(() => {
    let pitchingChanges = 0;
    let shifts = 0;
    let pinchMoves = 0;
    let signals = 0;

    for (const entry of sim.fullGame.strategicLog) {
      if (entry.type === 'pitching-change') pitchingChanges++;
      else if (entry.type === 'defensive-shift') shifts++;
      else if (entry.type === 'pinch-hit' || entry.type === 'pinch-run') pinchMoves++;
      else signals++;
    }

    return { pitchingChanges, shifts, pinchMoves, signals };
  }, [sim.fullGame.strategicLog]);

  const lastPitchingChange = useMemo(() => {
    for (let i = sim.fullGame.strategicLog.length - 1; i >= 0; i--) {
      const entry = sim.fullGame.strategicLog[i];
      if (entry.type === 'pitching-change') {
        return `${entry.half === 'top' ? 'T' : 'B'}${entry.inning} ${entry.team}: ${entry.detail}`;
      }
    }
    return 'none';
  }, [sim.fullGame.strategicLog]);

  const compactBullpenTrace = useMemo(() => {
    const homeRoles: string[] = [];
    const awayRoles: string[] = [];

    for (const entry of sim.fullGame.strategicLog) {
      if (entry.type !== 'pitching-change') continue;
      const roleMatch = entry.detail.match(/^\[([A-Z0-9]+)\]/);
      if (!roleMatch) continue;
      if (entry.team === 'home') homeRoles.push(roleMatch[1]);
      else awayRoles.push(roleMatch[1]);
    }

    return {
      home: homeRoles.slice(-8).join('>') || '-',
      away: awayRoles.slice(-8).join('>') || '-',
    };
  }, [sim.fullGame.strategicLog]);

  const runStatus = simulating
    ? 'running'
    : simError
      ? 'error'
      : 'idle';
  const parity = sim.tickAuthorityParity;

  return (
    <>
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
              <span className="font-mono text-xs text-amber-300">Tick @ 60 tps -&gt; 30 fps capture</span>
            </div>
            <div className="flex justify-between text-sm py-0.5">
              <span className="text-zinc-400">Collision</span>
              <span className="font-mono text-xs text-green-300">Colliders + Raycast + Walls</span>
            </div>
            <div className="flex justify-between text-sm py-0.5">
              <span className="text-zinc-400">Surfaces</span>
              <span className="font-mono text-xs text-blue-300">Dirt (9 ft/s^2) / Grass (14 ft/s^2)</span>
            </div>
            <div className="flex justify-between text-sm py-0.5">
              <span className="text-zinc-400">AI Manager</span>
              <span className="font-mono text-xs text-cyan-300">All 3 Tiers Active</span>
            </div>
            <div className="flex justify-between text-sm py-0.5">
              <span className="text-zinc-400">Home Manager</span>
              <span className="font-mono text-xs text-green-300">{profileIcons[homeProfileKey]} {PROFILE_LABELS[homeProfileKey]}</span>
            </div>
            <div className="flex justify-between text-sm py-0.5">
              <span className="text-zinc-400">Away Manager</span>
              <span className="font-mono text-xs text-blue-300">{profileIcons[awayProfileKey]} {PROFILE_LABELS[awayProfileKey]}</span>
            </div>
          </div>
        )}
      </section>

      <section className="bg-zinc-900 border border-zinc-800 rounded-lg flex-shrink-0">
        <button
          onClick={() => setDebugOpen(!debugOpen)}
          className="flex items-center justify-between w-full px-3 py-2 text-left hover:bg-zinc-800/50 rounded-t-lg transition-colors"
        >
          <h2 className="text-xs uppercase tracking-wider text-lime-400">Debug Panel</h2>
          <svg
            className={`w-4 h-4 text-zinc-500 transition-transform duration-200 ${debugOpen ? 'rotate-180' : ''}`}
            fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {debugOpen && (
          <div className="px-3 pb-3 font-mono text-xs space-y-1">
            <div className="flex justify-between">
              <span className="text-zinc-400">Run status</span>
              <span className={runStatus === 'error' ? 'text-red-300' : runStatus === 'running' ? 'text-amber-300' : 'text-emerald-300'}>{runStatus}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Worker</span>
              <span className={workerReady ? 'text-emerald-300' : 'text-amber-300'}>{workerReady ? 'ready' : 'fallback-only'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Run token / req</span>
              <span className="text-zinc-200">{runToken} / {latestRequestId}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Seed input / pinned</span>
              <span className="text-zinc-200">{seed} / {pinned}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Dispatch mode</span>
              <span className="text-zinc-200">{timingStats.mode}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Last / Avg (ms)</span>
              <span className="text-zinc-200">
                {timingStats.lastMs === null
                  ? 'n/a'
                  : `${timingStats.lastMs.toFixed(0)} / ${timingStats.avgMs?.toFixed(0) ?? 'n/a'}`}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Samples / Cancelled</span>
              <span className="text-zinc-200">{timingStats.samples} / {timingStats.cancelled}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">PBP entries / D-debug</span>
              <span className="text-zinc-200">{pbpCount} / {debugPbp ? 'on' : 'off'}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Tick authority phase</span>
              <span className="text-zinc-200">{sim.tickAuthorityPhase}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Authority enabled</span>
              <span className={sim.tickAuthorityEnabled ? 'text-emerald-300' : 'text-zinc-400'}>
                {sim.tickAuthorityEnabled ? 'yes' : 'no'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Tick deltas tracked</span>
              <span className="text-zinc-200">{sim.tickAuthorityDeltas.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Batted ball ABs</span>
              <span className="text-zinc-200">
                {parity.tickResolvedBattedBallAtBats}/{parity.battedBallAtBats}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Heuristic fallbacks</span>
              <span className={parity.battedBallHeuristicFallbacks > 0 ? 'text-amber-300' : 'text-emerald-300'}>
                {parity.battedBallHeuristicFallbacks}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Result mismatches</span>
              <span className={parity.resultMismatches > 0 ? 'text-amber-300' : 'text-emerald-300'}>
                {parity.resultMismatches}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Run mismatches (delta)</span>
              <span className={parity.runMismatches > 0 ? 'text-amber-300' : 'text-emerald-300'}>
                {parity.runMismatches} ({parity.totalRunDelta >= 0 ? '+' : ''}{parity.totalRunDelta})
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Out mismatches (delta)</span>
              <span className={parity.outMismatches > 0 ? 'text-amber-300' : 'text-emerald-300'}>
                {parity.outMismatches} ({parity.totalOutDelta >= 0 ? '+' : ''}{parity.totalOutDelta})
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Strategic log</span>
              <span className="text-zinc-200">{sim.fullGame.strategicLog.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Pitching/Shift/Pinch/Signal</span>
              <span className="text-zinc-200">
                {strategicCounts.pitchingChanges}/{strategicCounts.shifts}/{strategicCounts.pinchMoves}/{strategicCounts.signals}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-zinc-400">Compact bullpen role</span>
              <span className="text-zinc-200">A:{compactBullpenTrace.away} H:{compactBullpenTrace.home}</span>
            </div>
            <div className="pt-1 border-t border-zinc-800 text-zinc-300">
              Last pitching change: <span className="text-zinc-100">{lastPitchingChange}</span>
            </div>
          </div>
        )}
      </section>
    </>
  );
}
