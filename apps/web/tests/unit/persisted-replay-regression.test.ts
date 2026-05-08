// Last touched by agent: 2026-05-07T22:45:00Z
// Purpose: Prevent persisted replay regressions for skills, speed caps, and throw timing.

import { describe, expect, it } from 'vitest';
import { sprintFtPerSec, type Position } from '@baseballczar/sim-engine';
import type { FielderEntity } from '@baseballczar/tick-engine';
import { buildGroundOutThrowSequence } from '@/app/dashboard/games/[id]/persisted-replay-defense';
import {
  buildPersistedSnapshots,
  type PersistedGamePayload,
} from '@/app/dashboard/games/[id]/persisted-replay-data';
import { buildDefenseFrameForBall } from '@/app/dashboard/games/[id]/persisted-replay-motion';

function makeFielder(position: Position, overrides: Partial<FielderEntity> = {}): FielderEntity {
  return {
    position,
    pos: { x: 0, y: 0 },
    homePos: { x: 0, y: 0 },
    state: { type: 'idle' },
    speedFps: 20,
    agility: 5,
    facingRad: 0,
    turnRateRad: 5,
    throwVeloFps: 95,
    defense: 5,
    playerId: 1,
    teamColor: 0x123456,
    ...overrides,
  };
}

function makeReplayPayload(): PersistedGamePayload {
  return {
    game: {
      id: 1,
      home_team_id: 1,
      visitor_team_id: 2,
      home_runs: 0,
      visitor_runs: 0,
      home_hits: 0,
      visitor_hits: 0,
      home_errors: 0,
      visitor_errors: 0,
      innings: 9,
      home_linescore: null,
      visitor_linescore: null,
    },
    teamMap: {
      '1': 'Home',
      '2': 'Visitor',
    },
    events: [
      {
        seq: 1,
        inning: 1,
        half: 'top',
        outs: 0,
        batter_name: 'Jane Doe',
        pitcher_name: 'Max Ace',
        outcome: 6,
        description: 'Jane Doe grounds out to SS',
        visitor_runs: 0,
        home_runs: 0,
        runners_scored: null,
        hit_zone: 'INFIELD',
        spray_angle_deg: -9,
        launch_angle_deg: -11,
        exit_velo_mph: 82,
        ball_path_waypoints: null,
        base_occupancy_before: { first: 42, second: null, third: null },
        base_occupancy_after: { first: null, second: 42, third: null },
      },
    ],
    hitting: [
      {
        id: 100,
        team_id: 2,
        player_id: 42,
        bat_order: 1,
        position: '1B',
        ab: 1,
        r: 0,
        h: 0,
        b2: 0,
        b3: 0,
        hr: 0,
        rbi: 0,
        bb: 0,
        so: 0,
        players: {
          first_name: 'Runner',
          last_name: 'One',
          speed: 9,
          ag: 3,
          fielding: 5,
          throw: 5,
        },
      },
      {
        id: 101,
        team_id: 2,
        player_id: 77,
        bat_order: 2,
        position: 'LF',
        ab: 1,
        r: 0,
        h: 0,
        b2: 0,
        b3: 0,
        hr: 0,
        rbi: 0,
        bb: 0,
        so: 0,
        players: {
          first_name: 'Jane',
          last_name: 'Doe',
          hand_batting: 2,
          speed: 6,
          avg: 8,
          strength: 9,
          eye: 7,
          stamina: 4,
          ag: 6,
          play_intel: 6,
          bunting: 4,
          fielding: 5,
          throw: 5,
        },
      },
    ],
    pitching: [
      {
        id: 201,
        team_id: 1,
        player_id: 88,
        pitch_app: 1,
        ip: 0,
        h: 0,
        r: 0,
        bb: 0,
        so: 0,
        hr: 0,
        players: {
          first_name: 'Max',
          last_name: 'Ace',
          hand_throw: 2,
          stamina: 9,
          eye: 4,
          throw: 8,
          speed: 5,
          ag: 5,
          fielding: 6,
        },
      },
    ],
  };
}

describe('persisted replay regression guardrails', () => {
  it('maps at-bat card skills and hands from DB player summaries', () => {
    const replay = buildPersistedSnapshots(makeReplayPayload());
    const atBatStart = replay.snapshots
      .flatMap((snapshot) => snapshot.events)
      .find((event) => event.type === 'at-bat-start');

    if (!atBatStart || atBatStart.type !== 'at-bat-start') {
      throw new Error('Expected at-bat-start event in replay snapshots');
    }

    expect(atBatStart.batter.hand).toBe('L');
    expect(atBatStart.batter.avg).toBe(8);
    expect(atBatStart.batter.power).toBe(9);
    expect(atBatStart.batter.eye).toBe(7);
    expect(atBatStart.batter.speed).toBe(6);

    expect(atBatStart.pitcher.hand).toBe('L');
    expect(atBatStart.pitcher.ctrl).toBe(4);
    expect(atBatStart.pitcher.stam).toBe(9);
    expect(atBatStart.pitcher.throwing).toBe(8);
  });

  it('uses DB runner speed profile instead of fallback defaults', () => {
    const replay = buildPersistedSnapshots(makeReplayPayload());
    const inningChange = replay.snapshots.find((snapshot) => (
      snapshot.events.some((event) => event.type === 'inning-change')
    ));

    expect(inningChange).toBeDefined();

    const runner = inningChange?.runners.find((r) => r.id === 42);
    expect(runner).toBeDefined();
    expect(runner?.speedFps).toBeCloseTo(sprintFtPerSec(9), 6);
    expect(runner?.agility).toBe(3);
  });

  it('keeps chopped-ball contact apex near contact height (no inflated fallback apex)', () => {
    const replay = buildPersistedSnapshots(makeReplayPayload());
    const contact = replay.snapshots
      .flatMap((snapshot) => snapshot.events)
      .find((event) => event.type === 'contact');

    if (!contact || contact.type !== 'contact') {
      throw new Error('Expected contact event in replay snapshots');
    }

    expect(contact.peakHeightFt).toBeCloseTo(3, 6);
  });

  it('caps fielder movement by speedFps * dt', () => {
    const shortstop = makeFielder('SS', {
      pos: { x: 0, y: 0 },
      homePos: { x: 0, y: 0 },
      speedFps: 10,
    });

    const frame = buildDefenseFrameForBall(
      [shortstop],
      'INFIELD',
      { x: 100, y: 0 },
      false,
      () => 'SS',
      undefined,
      0.5,
    );

    const movedFt = Math.hypot(frame[0].pos.x, frame[0].pos.y);
    expect(movedFt).toBeLessThanOrEqual(5.0001);
    expect(movedFt).toBeGreaterThan(4.9);
  });

  it('uses thrower arm velocity for ground-out throw timing', () => {
    const waypoints = [{ label: 'fielded', x: 0, y: 100, z: 0, tSec: 1.2 }];

    const slowDefense = [
      makeFielder('SS', { throwVeloFps: 60, pos: { x: 0, y: 100 }, homePos: { x: 0, y: 100 } }),
      makeFielder('B1', { throwVeloFps: 95, pos: { x: 63.6, y: 63.6 }, homePos: { x: 63.6, y: 63.6 } }),
    ];

    const fastDefense = [
      makeFielder('SS', { throwVeloFps: 120, pos: { x: 0, y: 100 }, homePos: { x: 0, y: 100 } }),
      makeFielder('B1', { throwVeloFps: 95, pos: { x: 63.6, y: 63.6 }, homePos: { x: 63.6, y: 63.6 } }),
    ];

    const slow = buildGroundOutThrowSequence({
      defense: slowDefense,
      throwerPos: 'SS',
      waypoints,
      fallbackStart: waypoints[0],
      beforeBase: { first: null, second: null, third: null },
      afterBase: { first: null, second: null, third: null },
      runsScored: 0,
      batterRunnerId: 9000001,
      batterName: 'Jane Doe',
      startTimeSec: 0,
      gameState: undefined,
    });

    const fast = buildGroundOutThrowSequence({
      defense: fastDefense,
      throwerPos: 'SS',
      waypoints,
      fallbackStart: waypoints[0],
      beforeBase: { first: null, second: null, third: null },
      afterBase: { first: null, second: null, third: null },
      runsScored: 0,
      batterRunnerId: 9000001,
      batterName: 'Jane Doe',
      startTimeSec: 0,
      gameState: undefined,
    });

    expect(slow.endTimeSec).toBeGreaterThan(fast.endTimeSec);
    expect(slow.snapshots.length).toBeGreaterThan(fast.snapshots.length);
  });

  it('assigns right-side infield balls to 2B in replay attribution', () => {
    const payload = makeReplayPayload();
    payload.events[0] = {
      ...payload.events[0],
      description: 'Jane Doe grounds out to 2B',
      spray_angle_deg: 14,
      ball_path_waypoints: [
        { label: 'contact', x: 0, y: 0, z: 3, tSec: 0 },
        { label: 'landing', x: 46, y: 94, z: 0, tSec: 1.05 },
        { label: 'fielded', x: 46, y: 94, z: 0, tSec: 1.35 },
      ],
    };

    const replay = buildPersistedSnapshots(payload);
    const fielded = replay.snapshots
      .flatMap((snapshot) => snapshot.events)
      .find((event) => event.type === 'ball-fielded');

    if (!fielded || fielded.type !== 'ball-fielded') {
      throw new Error('Expected ball-fielded event in replay snapshots');
    }

    const atBatEnd = replay.snapshots
      .flatMap((snapshot) => snapshot.events)
      .find((event) => event.type === 'at-bat-end');

    if (!atBatEnd || atBatEnd.type !== 'at-bat-end') {
      throw new Error('Expected at-bat-end event in replay snapshots');
    }

    expect(fielded.by).toBe('B2');
    expect(atBatEnd.fieldedBy).toBe('B2');
  });
});
