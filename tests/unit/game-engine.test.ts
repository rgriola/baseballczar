import { describe, it, expect } from 'vitest';
import { simulateGame, type TeamInput, type LineupPlayer, type BullpenPitcher } from '@/lib/sim-engine/GameEngine';
import type { PlayerSkills, PitcherAttributes } from '@/lib/sim-engine/types';

function makeSkills(overrides?: Partial<PlayerSkills>): PlayerSkills {
  return { ag: 5, avg: 5, power: 5, eye: 5, dhr: 5, speed: 5, ...overrides };
}

function makePitcherSkills(overrides?: Partial<PitcherAttributes>): PitcherAttributes {
  return { ag: 5, avg: 5, power: 5, eye: 5, dhr: 5, speed: 5, stamina: 7, pitchIntel: 7, ...overrides };
}

function makeLineup(teamOffset: number): LineupPlayer[] {
  return Array.from({ length: 9 }, (_, i) => ({
    playerId: teamOffset + i,
    jerseyNo: i + 1,
    lastName: `Player${teamOffset + i}`,
    skills: makeSkills(),
  }));
}

function makeBullpen(teamOffset: number): BullpenPitcher[] {
  return Array.from({ length: 5 }, (_, i) => ({
    playerId: teamOffset + 100 + i,
    jerseyNo: 50 + i,
    lastName: `Pitcher${teamOffset + 100 + i}`,
    skills: makePitcherSkills(),
    isStarter: i === 0,
  }));
}

function makeTeam(teamId: number, name: string): TeamInput {
  return {
    teamId,
    teamName: name,
    lineup: makeLineup(teamId * 10),
    bullpen: makeBullpen(teamId * 10),
  };
}

describe('GameEngine — simulateGame integration', () => {
  const home = makeTeam(1, 'Home Tigers');
  const visitor = makeTeam(2, 'Visitor Eagles');

  it('returns a valid GameResult', () => {
    const result = simulateGame(visitor, home);

    expect(result.homeTeamId).toBe(home.teamId);
    expect(result.visitorTeamId).toBe(visitor.teamId);
    expect(result.innings).toBeGreaterThanOrEqual(9);
    expect(result.homeRuns).toBeGreaterThanOrEqual(0);
    expect(result.visitorRuns).toBeGreaterThanOrEqual(0);
    expect(result.winningTeamId).not.toBe(result.losingTeamId);
    expect([home.teamId, visitor.teamId]).toContain(result.winningTeamId);
    expect([home.teamId, visitor.teamId]).toContain(result.losingTeamId);
  });

  it('winning team always has more (or equal walk-off) runs', () => {
    const result = simulateGame(visitor, home);
    if (result.winningTeamId === home.teamId) {
      expect(result.homeRuns).toBeGreaterThanOrEqual(result.visitorRuns);
    } else {
      expect(result.visitorRuns).toBeGreaterThan(result.homeRuns);
    }
  });

  it('produces game events', () => {
    const result = simulateGame(visitor, home);
    expect(result.events.length).toBeGreaterThan(0);
    for (const ev of result.events.slice(0, 5)) {
      expect(ev.inning).toBeGreaterThanOrEqual(1);
      expect(['top', 'bottom']).toContain(ev.half);
      expect(ev.batterName).toBeTruthy();
      expect(ev.pitcherName).toBeTruthy();
    }
  });

  it('scoreboard tracks each inning', () => {
    const result = simulateGame(visitor, home);
    // Each full inning has a top score entry
    expect(result.scoreBoard.visitor.runs.length).toBeGreaterThanOrEqual(10); // index 0 unused + 9 innings
    expect(result.scoreBoard.home.runs.length).toBeGreaterThanOrEqual(9);
  });

  it('player stats maps cover all lineup players', () => {
    const result = simulateGame(visitor, home);
    for (const p of home.lineup) {
      expect(result.homePlayerStats.has(p.playerId)).toBe(true);
    }
    for (const p of visitor.lineup) {
      expect(result.visitorPlayerStats.has(p.playerId)).toBe(true);
    }
  });

  it('pitcher stats show at least 1 game for starters', () => {
    const result = simulateGame(visitor, home);
    const homeStarterStats = result.homePitcherStats.get(home.bullpen[0].playerId)!;
    const visitorStarterStats = result.visitorPitcherStats.get(visitor.bullpen[0].playerId)!;
    expect(homeStarterStats.g).toBe(1);
    expect(homeStarterStats.gs).toBe(1);
    expect(visitorStarterStats.g).toBe(1);
    expect(visitorStarterStats.gs).toBe(1);
  });

  it('hits = b1 + b2 + b3 + hr for each hitter', () => {
    const result = simulateGame(visitor, home);
    for (const [, stats] of result.homePlayerStats) {
      expect(stats.hits).toBe(stats.b1 + stats.b2 + stats.b3 + stats.hr);
    }
    for (const [, stats] of result.visitorPlayerStats) {
      expect(stats.hits).toBe(stats.b1 + stats.b2 + stats.b3 + stats.hr);
    }
  });

  it('total team runs match sum of individual player runs', () => {
    const result = simulateGame(visitor, home);
    let homeR = 0;
    for (const [, stats] of result.homePlayerStats) homeR += stats.r;
    let visitorR = 0;
    for (const [, stats] of result.visitorPlayerStats) visitorR += stats.r;
    expect(homeR).toBe(result.homeRuns);
    expect(visitorR).toBe(result.visitorRuns);
  });

  it('simulates consistently across many runs without crashing', () => {
    for (let i = 0; i < 20; i++) {
      const result = simulateGame(visitor, home);
      expect(result.homeRuns + result.visitorRuns).toBeGreaterThanOrEqual(0);
      expect(result.winningTeamId).toBeDefined();
    }
  });
});
