// Last touched by agent: 2026-05-07T23:55:00Z
// Purpose: Validates strict scheduled game contract invariants for persistence.

import { describe, expect, it } from 'vitest';
import { AtBatOutcome, type GameResult } from '@/lib/sim-engine/types';
import {
  assertGameResultContract,
  buildScheduledGameContract,
  SIM_VERSION_SCHEDULED_V2,
} from '@/lib/sim/game-result-contract';
import { buildGameInsertRow } from '@/lib/sim/persist-game-record';

function makeValidResult(): GameResult {
  return {
    homeTeamId: 1,
    visitorTeamId: 2,
    homeRuns: 1,
    visitorRuns: 0,
    homeHits: 4,
    visitorHits: 3,
    innings: 9,
    winningTeamId: 1,
    losingTeamId: 2,
    events: [
      {
        inning: 1,
        half: 'top',
        outs: 1,
        batterName: 'Visitor One',
        pitcherName: 'Home Ace',
        outcome: AtBatOutcome.Single,
        description: 'Visitor One singles.',
        visitorRuns: 0,
        homeRuns: 0,
        visitorHits: 1,
        homeHits: 0,
        runnersScored: [],
      },
      {
        inning: 9,
        half: 'top',
        outs: 3,
        batterName: 'Visitor Nine',
        pitcherName: 'Home Ace',
        outcome: AtBatOutcome.GroundOut,
        description: 'Visitor Nine grounds out.',
        visitorRuns: 0,
        homeRuns: 0,
        visitorHits: 3,
        homeHits: 0,
        runnersScored: [],
      },
      {
        inning: 9,
        half: 'bottom',
        outs: 2,
        batterName: 'Home Hero',
        pitcherName: 'Visitor Closer',
        outcome: AtBatOutcome.Single,
        description: 'Home Hero walks it off with a single.',
        visitorRuns: 0,
        homeRuns: 1,
        visitorHits: 3,
        homeHits: 4,
        runnersScored: ['Home Run'],
      },
    ],
    scoreBoard: {
      visitor: {
        name: 'Visitors',
        teamId: 2,
        finalInning: 9,
        totalRuns: 0,
        totalHits: 3,
        totalErrors: 0,
        runs: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
        hits: [0, 1, 0, 0, 1, 0, 0, 0, 1, 0],
        errors: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      },
      home: {
        name: 'Home',
        teamId: 1,
        finalInning: 9,
        totalRuns: 1,
        totalHits: 4,
        totalErrors: 0,
        runs: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
        hits: [0, 0, 1, 0, 0, 1, 0, 1, 0, 1],
        errors: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
      },
    },
    homePlayerStats: new Map([
      [
        101,
        {
          ab: 4,
          r: 1,
          b1: 2,
          b2: 1,
          b3: 0,
          hr: 0,
          rbi: 1,
          bb: 0,
          so: 0,
          hits: 3,
        },
      ],
    ]),
    visitorPlayerStats: new Map([
      [
        201,
        {
          ab: 4,
          r: 0,
          b1: 2,
          b2: 1,
          b3: 0,
          hr: 0,
          rbi: 0,
          bb: 0,
          so: 1,
          hits: 3,
        },
      ],
    ]),
    homePitcherStats: new Map([
      [
        301,
        {
          g: 1,
          gs: 1,
          w: 1,
          l: 0,
          sv: 0,
          cg: 1,
          sho: 1,
          ip: 9,
          om: 27,
          bf: 32,
          h: 3,
          r: 0,
          er: 0,
          bb: 1,
          so: 8,
          hr: 0,
        },
      ],
    ]),
    visitorPitcherStats: new Map([
      [
        401,
        {
          g: 1,
          gs: 1,
          w: 0,
          l: 1,
          sv: 0,
          cg: 0,
          sho: 0,
          ip: 8.2,
          om: 26,
          bf: 34,
          h: 4,
          r: 1,
          er: 1,
          bb: 1,
          so: 7,
          hr: 0,
        },
      ],
    ]),
  };
}

describe('game result contract', () => {
  it('builds a contract from a valid result with metadata', () => {
    const result = makeValidResult();

    const contract = buildScheduledGameContract(result, {
      scheduleId: 99,
      leagueId: 7,
      seasonNo: 1,
      seed: 12345,
      simVersion: SIM_VERSION_SCHEDULED_V2,
    });

    expect(contract.meta.scheduleId).toBe(99);
    expect(contract.meta.seed).toBe(12345);
    expect(contract.meta.configVersion).toBe('CONFIG_V1');
    expect(contract.meta.simVersion).toBe(SIM_VERSION_SCHEDULED_V2);
  });

  it('rejects winner/loser mismatch against final score', () => {
    const result = makeValidResult();
    result.winningTeamId = result.visitorTeamId;
    result.losingTeamId = result.homeTeamId;

    expect(() => assertGameResultContract(result)).toThrow('winningTeamId does not match final score');
  });

  it('rejects event timeline that does not end on final score', () => {
    const result = makeValidResult();
    const lastEvent = result.events[result.events.length - 1];
    result.events[result.events.length - 1] = {
      ...lastEvent,
      homeRuns: 0,
    };

    expect(() => assertGameResultContract(result)).toThrow('last event scoreboard does not match final runs');
  });

  it('maps sim provenance into games insert row payload', () => {
    const row = buildGameInsertRow(makeValidResult(), {
      scheduleId: 44,
      leagueId: 9,
      provenance: {
        simSeed: 12345,
        simVersion: 'scheduled-v2-adapter-v1',
        simConfigVersion: 'CONFIG_V1',
      },
    });

    expect(row).toMatchObject({
      schedule_id: 44,
      league_id: 9,
      sim_seed: 12345,
      sim_version: 'scheduled-v2-adapter-v1',
      sim_config_version: 'CONFIG_V1',
    });
  });
});
