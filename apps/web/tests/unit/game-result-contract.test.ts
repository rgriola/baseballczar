// Last touched by agent: 2026-05-14T09:49:00Z
// Purpose: Validates strict scheduled game contract invariants for persistence.
// Uses engine-native GameResult type directly.

import { describe, expect, it } from 'vitest';
import type { GameResult, Team, Player, AtBatRecord, BatterGameStats, PitcherGameStats, FielderGameStats } from '@baseballczar/sim-engine';
import type { Position } from '@baseballczar/sim-engine';
import {
  assertGameResultContract,
  buildScheduledGameContract,
  SIM_VERSION_TICK_FULL,
} from '@/lib/sim/game-result-contract';
import { buildGameInsertRow, buildLinescore } from '@/lib/sim/persist-game-record';

function makeFakePlayer(id: number, last: string): Player {
  return {
    id,
    jerseyNumber: id,
    firstName: 'Test',
    lastName: last,
    hand: 'R',
    position: 'RF' as Position,
    skills: {
      speed: 5, ag: 5, stamina: 5, eye: 5, avg: 5, power: 5, dhr: 5,
      fielding: 5, throwing: 5, playIntelligence: 5,
    },
  };
}

function makeFakeTeam(id: number, name: string, playerIds: number[]): Team {
  const players = playerIds.map(pid => makeFakePlayer(pid, `P${pid}`));
  return {
    id,
    name,
    abbrev: name.slice(0, 3).toUpperCase(),
    roster: players,
    lineup: players.slice(0, 9),
    rotation: [makeFakePlayer(300 + id, `SP${id}`)],
    bullpen: [makeFakePlayer(400 + id, `RP${id}`)],
    bench: [],
  };
}

function makeAtBat(inning: number, half: 'top' | 'bottom', result: string, runsScored = 0): AtBatRecord {
  return {
    inning,
    half,
    outs: 1,
    batter: makeFakePlayer(100, 'Batter'),
    pitcher: makeFakePlayer(200, 'Pitcher'),
    pitches: [{
      pitchNum: 1, balls: 0, strikes: 1, intentZone: 'in', actualInZone: true,
      swung: true, outcome: 'in-play', mph: 90, pitchType: 'Fastball',
    }],
    result: result as AtBatRecord['result'],
    rbis: runsScored,
    runsScored,
  };
}

function makeValidResult(): GameResult {
  const homeTeam = makeFakeTeam(1, 'Home', [101, 102, 103, 104, 105, 106, 107, 108, 109]);
  const awayTeam = makeFakeTeam(2, 'Away', [201, 202, 203, 204, 205, 206, 207, 208, 209]);

  const atBats: AtBatRecord[] = [
    makeAtBat(1, 'top', 'single'),
    makeAtBat(1, 'bottom', 'single', 1),
    makeAtBat(9, 'top', 'ground-out'),
  ];

  const batterStats = new Map<number, BatterGameStats>([
    [101, {
      batterId: 101, pa: 4, ab: 4, hits: 2, doubles: 1, triples: 0,
      homeRuns: 0, walks: 0, strikeouts: 0, runs: 1, rbis: 1, sb: 0, cs: 0,
      putouts: 0, assists: 0, errors: 0,
      battedBalls: 2, totalEV: 180, totalLA: 20, totalSpray: 10, totalBatSpeed: 140,
    }],
    [201, {
      batterId: 201, pa: 4, ab: 4, hits: 1, doubles: 0, triples: 0,
      homeRuns: 0, walks: 0, strikeouts: 1, runs: 0, rbis: 0, sb: 0, cs: 0,
      putouts: 0, assists: 0, errors: 0,
      battedBalls: 1, totalEV: 90, totalLA: 15, totalSpray: 5, totalBatSpeed: 70,
    }],
  ]);

  const pitcherStats = new Map<number, PitcherGameStats>([
    [301, {
      pitcherId: 301, battersFaced: 32, pitches: 100, outs: 27, hits: 3,
      runs: 0, earnedRuns: 0, walks: 1, strikeouts: 8, homeRuns: 0,
      putouts: 0, assists: 0, errors: 0, totalMph: 9000,
    }],
    [302, {
      pitcherId: 302, battersFaced: 34, pitches: 110, outs: 26, hits: 4,
      runs: 1, earnedRuns: 1, walks: 1, strikeouts: 7, homeRuns: 0,
      putouts: 0, assists: 0, errors: 0, totalMph: 9500,
    }],
  ]);

  const fielderStats = new Map<number, FielderGameStats>([
    [101, { playerId: 101, position: 'SS' as Position, putouts: 3, assists: 2, errors: 0 }],
  ]);

  return {
    homeTeam,
    awayTeam,
    homeRuns: 1,
    awayRuns: 0,
    innings: 9,
    atBats,
    batterStats,
    pitcherStats,
    fielderStats,
  };
}

describe('game result contract', () => {
  it('builds a contract from a valid engine result with metadata', () => {
    const result = makeValidResult();

    const contract = buildScheduledGameContract(result, {
      scheduleId: 99,
      leagueId: 7,
      seasonNo: 1,
      seed: 12345,
      simVersion: SIM_VERSION_TICK_FULL,
    });

    expect(contract.meta.scheduleId).toBe(99);
    expect(contract.meta.seed).toBe(12345);
    expect(contract.meta.configVersion).toBe('CONFIG_V1');
    expect(contract.meta.simVersion).toBe(SIM_VERSION_TICK_FULL);
  });

  it('rejects same homeTeam and awayTeam IDs', () => {
    const result = makeValidResult();
    result.awayTeam = { ...result.homeTeam };

    expect(() => assertGameResultContract(result)).toThrow('homeTeam.id and awayTeam.id must differ');
  });

  it('rejects tied games', () => {
    const result = makeValidResult();
    result.awayRuns = result.homeRuns;

    expect(() => assertGameResultContract(result)).toThrow('games must end with a winner');
  });

  it('maps sim provenance into games insert row payload', () => {
    const result = makeValidResult();
    const homeLinescore = buildLinescore(result.atBats, result.innings, 'bottom');
    const visitorLinescore = buildLinescore(result.atBats, result.innings, 'top');

    const row = buildGameInsertRow(result, homeLinescore, visitorLinescore, {
      scheduleId: 44,
      leagueId: 9,
      provenance: {
        simSeed: 12345,
        simVersion: 'tick-engine-full-v1',
        simConfigVersion: 'CONFIG_V1',
      },
    });

    expect(row).toMatchObject({
      schedule_id: 44,
      league_id: 9,
      sim_seed: 12345,
      sim_version: 'tick-engine-full-v1',
      sim_config_version: 'CONFIG_V1',
    });
  });

  it('builds correct linescore from atBats', () => {
    const result = makeValidResult();
    const homeLinescore = buildLinescore(result.atBats, result.innings, 'bottom');

    expect(homeLinescore.totalRuns).toBe(1);
    expect(homeLinescore.totalHits).toBe(1);
    expect(homeLinescore.runs[1]).toBe(1); // bottom of 1st: 1 run
  });
});
