// Purpose: Re-simulates a persisted game client-side using the stored seed
// and game-day roster snapshots, producing 30fps tick engine snapshots
// identical to Sim Lab 2 quality.

import { createRng, simulateGame } from '@baseballczar/sim-engine';
import type { Team, Player, Skills, Hand, Position, GameResult } from '@baseballczar/sim-engine';
import { simulateFullGame } from '@baseballczar/tick-engine/gameOrchestrator';
import type { WorldSnapshot } from '@baseballczar/tick-engine';
import type { RosterSnapshot, PlayerSnapshot } from '@/lib/sim/simulate-scheduled-game';

export interface ResimPayload {
  game: {
    sim_seed: number | null;
    sim_version: string | null;
    home_team_id: number;
    visitor_team_id: number;
    home_roster_snapshot: RosterSnapshot | null;
    visitor_roster_snapshot: RosterSnapshot | null;
  };
}

export interface ResimResult {
  snapshots: WorldSnapshot[];
  totalDurationSec: number;
}

/**
 * Check whether a game payload has the data needed for tick-engine re-simulation.
 */
export function canResimulate(payload: ResimPayload): boolean {
  const g = payload.game;
  return (
    g.sim_seed != null &&
    g.sim_seed > 0 &&
    g.home_roster_snapshot != null &&
    g.visitor_roster_snapshot != null &&
    Array.isArray(g.home_roster_snapshot.lineup) &&
    g.home_roster_snapshot.lineup.length >= 9 &&
    Array.isArray(g.visitor_roster_snapshot.lineup) &&
    g.visitor_roster_snapshot.lineup.length >= 9
  );
}

/**
 * Re-simulate a persisted game using the tick engine.
 * Returns 30fps WorldSnapshots for the renderer.
 *
 * Throws if the payload doesn't have the required data (check canResimulate first).
 */
export function resimulateForReplay(payload: ResimPayload): ResimResult {
  const g = payload.game;

  if (!canResimulate(payload)) {
    throw new Error('Cannot re-simulate: missing seed or roster snapshots');
  }

  const homeTeam = snapshotToTeam(g.home_roster_snapshot!);
  const awayTeam = snapshotToTeam(g.visitor_roster_snapshot!);
  const homeStarterIndex = g.home_roster_snapshot!.starterIndex ?? 0;
  const awayStarterIndex = g.visitor_roster_snapshot!.starterIndex ?? 0;

  // Re-run the sim engine with the same seed → deterministic, same AtBatRecord[]
  const rng = createRng(g.sim_seed!);
  const gameResult = simulateGame(homeTeam, awayTeam, rng, {
    homeStarterIndex,
    awayStarterIndex,
  });

  // Run the tick engine → 30fps physics snapshots (same pipeline as Sim Lab 2)
  const fullGame = simulateFullGame(gameResult, homeTeam, awayTeam, {
    captureEvery: 2,  // 30fps output
    homeStarterIndex,
    awayStarterIndex,
  });

  return {
    snapshots: fullGame.snapshots,
    totalDurationSec: fullGame.totalDurationSec,
  };
}

// ─── Snapshot → Team conversion ──────────────────────────────

function snapshotToTeam(snap: RosterSnapshot): Team {
  const lineup = snap.lineup.map(snapshotToPlayer);
  const rotation = snap.rotation.map(snapshotToPlayer);
  const bullpen = snap.bullpen.map(snapshotToPlayer);
  const bench = snap.bench.map(snapshotToPlayer);

  // Build full roster from all groups (deduplicated by id)
  const seen = new Set<number>();
  const roster: Player[] = [];
  for (const group of [lineup, rotation, bullpen, bench]) {
    for (const p of group) {
      if (!seen.has(p.id)) {
        seen.add(p.id);
        roster.push(p);
      }
    }
  }

  return {
    id: snap.id,
    name: snap.name,
    abbrev: snap.abbrev,
    roster,
    lineup,
    rotation,
    bullpen,
    bench,
  };
}

function snapshotToPlayer(snap: PlayerSnapshot): Player {
  const skills: Skills = {
    speed: snap.skills.speed,
    ag: snap.skills.ag,
    stamina: snap.skills.stamina,
    eye: snap.skills.eye,
    avg: snap.skills.avg,
    power: snap.skills.power,
    dhr: snap.skills.dhr,
    fielding: snap.skills.fielding,
    throwing: snap.skills.throwing,
    playIntelligence: snap.skills.playIntelligence,
    bunting: snap.skills.bunting,
    karma: snap.skills.karma,
  };

  return {
    id: snap.id,
    firstName: snap.firstName,
    lastName: snap.lastName,
    hand: snap.hand as Hand,
    position: snap.position as Position,
    skills,
  };
}
