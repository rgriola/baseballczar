// Last touched by agent: 2026-05-07T23:35:00Z
/**
 * Simulate a single scheduled game — loads rosters from Supabase,
 * runs the sim engine, and persists all results.
 *
 * Used by: API routes, BullMQ worker, scheduler.
 */

import { SupabaseClient } from '@supabase/supabase-js';
import {
  createRng,
  simulateGame as simulateGameV2,
  type Hand as V2Hand,
  type Player as V2Player,
  type Position as V2Position,
  type Team as V2Team,
} from '@baseballczar/sim-engine';
import {
  simulateGame as simulateLegacyGame,
  type TeamInput,
  type LineupPlayer,
  type BullpenPitcher,
} from '../sim-engine/GameEngine';
import {
  type PitcherAttributes,
  type PlayerSkills,
} from '../sim-engine/types';
import { persistGameResult } from './persist-game';
import {
  adaptV2ResultToLegacy,
  type ScheduledTeamAdapterInput,
} from './scheduled-v2-adapter';
import {
  buildScheduledGameContract,
  SIM_VERSION_SCHEDULED_LEGACY,
  SIM_VERSION_SCHEDULED_V2,
} from './game-result-contract';

interface SimulateScheduledGameResult {
  gameId: number;
  homeRuns: number;
  visitorRuns: number;
  winningTeamId: number;
}

interface HitterRow {
  id: number;
  first_name: string;
  last_name: string;
  jersey_no: number;
  position: string;
  batt_order: number;
  hand_batting: number;
  speed: number;
  stamina: number;
  ag: number;
  eye: number;
  avg: number;
  strength: number;
  dhr: number;
  play_intel: number;
  bunting: number;
  fielding: number;
  throw: number;
  karma: number;
}

interface PitcherRow {
  id: number;
  first_name: string;
  last_name: string;
  jersey_no: number;
  hand_batting: number;
  rotation_slot: number;
  speed: number;
  stamina: number;
  ag: number;
  eye: number;
  avg: number;
  strength: number;
  dhr: number;
  play_intel: number;
  bunting: number;
  fielding: number;
  throw: number;
  karma: number;
}

interface TeamBuild {
  teamInput: TeamInput;
  v2Team: V2Team;
  v2StarterIndex: number;
  hitterMeta: Map<number, { teamId: number; position: string; batOrder: number }>;
  pitcherMeta: Map<number, { teamId: number }>;
}

/**
 * Simulate a game from a schedule entry.
 * @param supabase - Service-role Supabase client
 * @param scheduleId - The schedule row to simulate
 */
export async function simulateScheduledGame(
  supabase: SupabaseClient,
  scheduleId: number,
): Promise<SimulateScheduledGameResult> {
  // 1. Fetch schedule entry
  const { data: sched, error: schedErr } = await supabase
    .from('schedules')
    .select('id, league_id, home_team_id, visitor_team_id, game_type, season_no, played')
    .eq('id', scheduleId)
    .single();

  if (schedErr || !sched) {
    throw new Error(`Schedule ${scheduleId} not found: ${schedErr?.message}`);
  }
  if (sched.played) {
    throw new Error(`Schedule ${scheduleId} already played`);
  }

  // 2. Load team data (including next_sp_slot for rotation tracking)
  const { data: homeTeam } = await supabase
    .from('teams')
    .select('id, team_name, next_sp_slot')
    .eq('id', sched.home_team_id)
    .single();

  const { data: visitorTeam } = await supabase
    .from('teams')
    .select('id, team_name, next_sp_slot')
    .eq('id', sched.visitor_team_id)
    .single();

  if (!homeTeam || !visitorTeam) {
    throw new Error('Could not load teams');
  }

  // 3. Load rosters (pass next_sp_slot so the correct starter is chosen)
  const homeInput = await buildTeamInput(supabase, homeTeam.id, homeTeam.team_name, homeTeam.next_sp_slot ?? 1);
  const visitorInput = await buildTeamInput(
    supabase,
    visitorTeam.id,
    visitorTeam.team_name,
    visitorTeam.next_sp_slot ?? 1,
  );

  // 4. Run simulation
  const useV2 = isScheduledEngineV2Enabled();
  const seed = computeScheduledSeed(sched.id, sched.league_id, sched.season_no);

  const result = useV2
    ? adaptV2ResultToLegacy(
      simulateGameV2(
        homeInput.v2Team,
        visitorInput.v2Team,
        createRng(seed),
        {
          homeStarterIndex: homeInput.v2StarterIndex,
          awayStarterIndex: visitorInput.v2StarterIndex,
        },
      ),
      toAdapterInput(visitorInput),
      toAdapterInput(homeInput),
    )
    : simulateLegacyGame(visitorInput.teamInput, homeInput.teamInput);

  const contract = buildScheduledGameContract(result, {
    scheduleId: sched.id,
    leagueId: sched.league_id,
    seasonNo: sched.season_no,
    seed,
    simVersion: useV2 ? SIM_VERSION_SCHEDULED_V2 : SIM_VERSION_SCHEDULED_LEGACY,
  });

  // 5. Persist
  const gameId = await persistGameResult(supabase, contract, {
    scheduleId: sched.id,
    leagueId: sched.league_id,
    seasonNo: sched.season_no,
    gameType: sched.game_type,
    homeHitterMeta: homeInput.hitterMeta,
    visitorHitterMeta: visitorInput.hitterMeta,
    homePitcherMeta: homeInput.pitcherMeta,
    visitorPitcherMeta: visitorInput.pitcherMeta,
  });

  // 6. Advance starting pitcher rotation (SP1→SP2→…→SP5→SP1)
  const homeNextSlot = ((homeTeam.next_sp_slot ?? 1) % 5) + 1;
  const visitorNextSlot = ((visitorTeam.next_sp_slot ?? 1) % 5) + 1;
  await supabase.from('teams').update({ next_sp_slot: homeNextSlot }).eq('id', homeTeam.id);
  await supabase.from('teams').update({ next_sp_slot: visitorNextSlot }).eq('id', visitorTeam.id);

  return {
    gameId,
    homeRuns: result.homeRuns,
    visitorRuns: result.visitorRuns,
    winningTeamId: result.winningTeamId,
  };
}

function isScheduledEngineV2Enabled(): boolean {
  const raw = process.env.SIM_SCHEDULED_ENGINE_V2;
  if (raw == null) return false;
  const value = raw.trim().toLowerCase();
  return value === '1' || value === 'true' || value === 'on';
}

function computeScheduledSeed(scheduleId: number, leagueId: number, seasonNo: number): number {
  const seed = (scheduleId * 104729) ^ (leagueId * 8191) ^ (seasonNo * 131);
  return Math.abs(seed) + 1;
}

// ─── Roster loading ──────────────────────────────────────────

async function buildTeamInput(
  supabase: SupabaseClient,
  teamId: number,
  teamName: string,
  nextSpSlot: number,
): Promise<TeamBuild> {
  // Load active hitters (ordered by batt_order)
  const { data: hitters, error: hErr } = await supabase
    .from('players')
    .select('id, first_name, last_name, jersey_no, position, batt_order, hand_batting, speed, stamina, ag, eye, avg, strength, dhr, play_intel, bunting, fielding, throw, karma')
    .eq('team_id', teamId)
    .eq('fielder', true)
    .eq('roster_status', 'active')
    .gte('batt_order', 1)
    .lte('batt_order', 9)
    .order('batt_order');

  // Normalize to exact batting slots 1..9 so we never drift array order.
  const lineupSlots: Array<HitterRow | null> = new Array(9).fill(null);
  for (const hitter of (hitters ?? []) as HitterRow[]) {
    const slotIdx = hitter.batt_order - 1;
    if (slotIdx < 0 || slotIdx > 8) continue;
    if (!lineupSlots[slotIdx]) {
      lineupSlots[slotIdx] = hitter;
    }
  }

  const missingSlots = lineupSlots
    .map((row, idx) => (row ? null : idx + 1))
    .filter((slot): slot is number => slot !== null);

  // If one or more lineup slots are missing, fill them from active fielders.
  if (!hErr && missingSlots.length > 0) {
    const existingIds = lineupSlots
      .filter((row): row is HitterRow => Boolean(row))
      .map((row) => row.id);
    const { data: bench } = await supabase
      .from('players')
      .select('id, first_name, last_name, jersey_no, position, batt_order, hand_batting, speed, stamina, ag, eye, avg, strength, dhr, play_intel, bunting, fielding, throw, karma')
      .eq('team_id', teamId)
      .eq('fielder', true)
      .eq('roster_status', 'active')
      .not('id', 'in', existingIds.length > 0 ? `(${existingIds.join(',')})` : '(0)')
      .order('batt_order', { ascending: true })
      .order('id', { ascending: true })
      .limit(missingSlots.length);

    const benchRows = [...((bench ?? []) as HitterRow[])];
    for (const slot of missingSlots) {
      const filler = benchRows.shift();
      if (!filler) break;
      lineupSlots[slot - 1] = {
        ...filler,
        batt_order: slot,
      };
    }
  }

  const finalHitters = lineupSlots.filter((row): row is HitterRow => Boolean(row));

  if (hErr || finalHitters.length < 9) {
    throw new Error(`Team ${teamId} has insufficient lineup hitters (${finalHitters.length})`);
  }

  // Load pitchers (rotation slots 1-12: SP1-5, RP1-4, CL, optional RP5-6)
  const { data: pitchers, error: pErr } = await supabase
    .from('players')
    .select('id, first_name, last_name, jersey_no, hand_batting, rotation_slot, speed, stamina, ag, eye, avg, strength, dhr, play_intel, bunting, fielding, throw, karma')
    .eq('team_id', teamId)
    .eq('fielder', false)
    .eq('roster_status', 'active')
    .gt('rotation_slot', 0)
    .lte('rotation_slot', 12)
    .order('rotation_slot');

  if (pErr || !pitchers || pitchers.length < 1) {
    throw new Error(`Team ${teamId} has no active pitchers`);
  }

  const pitcherRows = pitchers as PitcherRow[];

  // Identify today's starting pitcher by next_sp_slot
  const starterSlot = Math.max(1, Math.min(5, nextSpSlot)); // clamp 1-5
  const starterPitcher = pitcherRows.find((p) => p.rotation_slot === starterSlot);
  // Fallback: if the designated slot is empty, use the first available SP
  const actualStarter = starterPitcher ?? pitcherRows.find((p) => p.rotation_slot >= 1 && p.rotation_slot <= 5);

  if (!actualStarter) {
    throw new Error(`Team ${teamId} has no starting pitcher for slot SP${starterSlot}`);
  }

  // Separate relievers (RP slots 6-9 primary, 11-12 optional) and closer (slot 10)
  const relievers = pitcherRows.filter((p) =>
    (p.rotation_slot >= 6 && p.rotation_slot <= 9)
    || (p.rotation_slot >= 11 && p.rotation_slot <= 12),
  );
  const closerPitcher = pitcherRows.find((p) => p.rotation_slot === 10);

  // Build legacy lineup
  const lineup: LineupPlayer[] = finalHitters.map((h) => ({
    playerId: h.id,
    jerseyNo: h.jersey_no,
    lastName: h.last_name,
    skills: {
      ag: clampSkill(h.ag),
      avg: clampSkill(h.avg),
      power: clampSkill(h.strength),
      eye: clampSkill(h.eye),
      dhr: clampSkill(h.dhr),
      speed: clampSkill(h.speed),
    } as PlayerSkills,
  }));

  function toBullpenEntry(row: PitcherRow, isStarter: boolean, isCloser: boolean): BullpenPitcher {
    return {
      playerId: row.id,
      jerseyNo: row.jersey_no,
      lastName: row.last_name,
      skills: {
        ag: clampSkill(row.ag),
        avg: clampSkill(row.avg),
        power: clampSkill(row.strength),
        eye: clampSkill(row.eye),
        dhr: clampSkill(row.dhr),
        speed: clampSkill(row.speed),
        stamina: clampSkill(row.stamina),
      } as PitcherAttributes,
      isStarter,
      isCloser,
    };
  }

  const bullpen: BullpenPitcher[] = [
    toBullpenEntry(actualStarter, true, false),
    ...relievers.map((p) => toBullpenEntry(p, false, false)),
    ...(closerPitcher ? [toBullpenEntry(closerPitcher, false, true)] : []),
  ];

  // Build metadata maps
  const hitterMeta = new Map<number, { teamId: number; position: string; batOrder: number }>();
  for (const h of finalHitters) {
    hitterMeta.set(h.id, { teamId, position: h.position, batOrder: h.batt_order });
  }

  const pitcherMeta = new Map<number, { teamId: number }>();
  for (const p of pitcherRows) {
    pitcherMeta.set(p.id, { teamId });
  }

  const v2PitchersById = new Map<number, V2Player>();
  for (const row of pitcherRows) {
    v2PitchersById.set(row.id, toV2Pitcher(row));
  }

  const rotationRows = pitcherRows
    .filter((p) => p.rotation_slot >= 1 && p.rotation_slot <= 5)
    .sort((a, b) => a.rotation_slot - b.rotation_slot);
  const rotation = rotationRows.map((row) => v2PitchersById.get(row.id)).filter((p): p is V2Player => Boolean(p));
  if (rotation.length === 0) {
    rotation.push(v2PitchersById.get(actualStarter.id)!);
  }

  let v2StarterIndex = rotation.findIndex((p) => p.id === actualStarter.id);
  if (v2StarterIndex < 0) {
    rotation.unshift(v2PitchersById.get(actualStarter.id)!);
    v2StarterIndex = 0;
  }

  const bullpenPlayers: V2Player[] = [];
  for (const row of pitcherRows) {
    if (row.rotation_slot < 6 || row.rotation_slot > 12) continue;
    const pitcher = v2PitchersById.get(row.id);
    if (!pitcher) continue;
    bullpenPlayers.push(pitcher);
  }
  for (const row of pitcherRows) {
    const pitcher = v2PitchersById.get(row.id);
    if (!pitcher) continue;
    if (rotation.some((r) => r.id === pitcher.id)) continue;
    if (bullpenPlayers.some((r) => r.id === pitcher.id)) continue;
    bullpenPlayers.push(pitcher);
  }

  // Batting order must stay exactly 1..9 from lineup slots (DH included).
  const v2Lineup: V2Player[] = finalHitters.map((hitter) => toV2Hitter(hitter));

  const rosterMap = new Map<number, V2Player>();
  for (const player of [...v2Lineup, ...rotation, ...bullpenPlayers, ...finalHitters.map(toV2Hitter)]) {
    rosterMap.set(player.id, player);
  }
  const roster = Array.from(rosterMap.values());

  const lineupIds = new Set(v2Lineup.map((p) => p.id));
  const rotationIds = new Set(rotation.map((p) => p.id));
  const bullpenIds = new Set(bullpenPlayers.map((p) => p.id));
  const bench = roster.filter((p) => !lineupIds.has(p.id) && !rotationIds.has(p.id) && !bullpenIds.has(p.id));

  const v2Team: V2Team = {
    id: teamId,
    name: teamName,
    abbrev: toTeamAbbrev(teamName),
    roster,
    lineup: v2Lineup,
    rotation,
    bullpen: bullpenPlayers,
    bench,
  };

  return {
    teamInput: { teamId, teamName, lineup, bullpen },
    v2Team,
    v2StarterIndex,
    hitterMeta,
    pitcherMeta,
  };
}

function clampSkill(raw: number): number {
  const value = Number.isFinite(raw) ? Math.round(raw) : 1;
  return Math.max(1, Math.min(10, value));
}

function toTeamAbbrev(teamName: string): string {
  const chars = teamName.toUpperCase().replace(/[^A-Z]/g, '');
  const base = chars.slice(0, 3);
  return (base.length >= 3 ? base : `${base}XXX`.slice(0, 3));
}

function toV2Hand(handBatting: number): V2Hand {
  if (handBatting === 2) return 'L';
  if (handBatting === 3) return 'S';
  return 'R';
}

function toV2Position(rawPosition: string): V2Position {
  const p = rawPosition.toUpperCase();
  if (p === 'P') return 'P';
  // V2 has no DH position type; map DH to P so it stays bat-only in defense mapping.
  if (p === 'DH') return 'P';
  if (p === 'C') return 'C';
  if (p === '1B' || p === 'B1') return 'B1';
  if (p === '2B' || p === 'B2') return 'B2';
  if (p === '3B' || p === 'B3') return 'B3';
  if (p === 'SS') return 'SS';
  if (p === 'LF') return 'LF';
  if (p === 'CF') return 'CF';
  if (p === 'RF') return 'RF';
  return 'CF';
}

function toV2Hitter(row: HitterRow): V2Player {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    hand: toV2Hand(row.hand_batting),
    position: toV2Position(row.position),
    skills: {
      speed: clampSkill(row.speed),
      ag: clampSkill(row.ag),
      stamina: clampSkill(row.stamina),
      eye: clampSkill(row.eye),
      avg: clampSkill(row.avg),
      power: clampSkill(row.strength),
      dhr: clampSkill(row.dhr),
      fielding: clampSkill(row.fielding),
      throwing: clampSkill(row.throw),
      playIntelligence: clampSkill(row.play_intel),
      bunting: clampSkill(row.bunting),
      karma: clampSkill(row.karma),
    },
  };
}

function toV2Pitcher(row: PitcherRow): V2Player {
  return {
    id: row.id,
    firstName: row.first_name,
    lastName: row.last_name,
    hand: toV2Hand(row.hand_batting),
    position: 'P',
    skills: {
      speed: clampSkill(row.speed),
      ag: clampSkill(row.ag),
      stamina: clampSkill(row.stamina),
      eye: clampSkill(row.eye),
      avg: clampSkill(row.avg),
      power: clampSkill(row.strength),
      dhr: clampSkill(row.dhr),
      fielding: clampSkill(row.fielding),
      throwing: clampSkill(row.throw),
      playIntelligence: clampSkill(row.play_intel),
      bunting: clampSkill(row.bunting),
      karma: clampSkill(row.karma),
    },
  };
}

function toAdapterInput(team: TeamBuild): ScheduledTeamAdapterInput {
  const starterPitcherId = team.v2Team.rotation[team.v2StarterIndex]?.id
    ?? team.v2Team.rotation[0]?.id
    ?? -1;

  return {
    teamId: team.teamInput.teamId,
    teamName: team.teamInput.teamName,
    hitterIds: new Set(team.hitterMeta.keys()),
    pitcherIds: new Set(team.pitcherMeta.keys()),
    starterPitcherId,
  };
}

