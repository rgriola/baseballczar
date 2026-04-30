import { describe, it, expect } from 'vitest';
import {
  resolveFoulBall,
  FIELDER_POSITIONS_FT,
  type BattedBall,
  type Player,
  type Position,
} from '@baseballczar/sim-engine';

// ─── Test fixtures ─────────────────────────────────────────────
function makePlayer(position: Position, id: number): Player {
  return {
    id,
    firstName: 'Test',
    lastName: position,
    hand: 'R',
    position,
    skills: {
      ag: 5, avg: 5, power: 5, eye: 5, dhr: 5, speed: 5,
      stamina: 5, pitchIntel: 5, defense: 5,
    },
  };
}

function makeDefense(): Map<Position, Player> {
  const positions: Position[] = ['P', 'C', 'B1', 'B2', 'SS', 'B3', 'LF', 'CF', 'RF'];
  return new Map(positions.map((p, i) => [p, makePlayer(p, i + 1)]));
}

function makeBall(overrides: Partial<BattedBall>): BattedBall {
  return {
    exitVeloMph: 70,
    launchAngleDeg: 60,
    sprayAngleDeg: 0,
    distanceFt: 50,
    hangTimeSec: 4.0,
    peakHeightFt: 40,
    landingPoint: { x: 0, y: 0 },
    landingSpeedFps: 50,
    restPoint: { x: 0, y: 0 },
    rollDistanceFt: 0,
    isFoul: true,
    isHomeRun: false,
    ...overrides,
  };
}

describe('resolveFoulBall', () => {
  const defense = makeDefense();

  it('catches a routine pop-up near the catcher', () => {
    // High pop, lands ~10ft in front of catcher (C is at (0, -3))
    const ball = makeBall({
      launchAngleDeg: 70,
      hangTimeSec: 4.5,
      landingPoint: { x: 0, y: 5 },
    });
    const caught = resolveFoulBall(ball, defense);
    expect(caught).not.toBeNull();
    expect(caught?.position).toBe('C');
  });

  it('returns null for a line-drive foul (LA below threshold)', () => {
    // Line drive into the seats — too low to chase
    const ball = makeBall({
      launchAngleDeg: 15,
      hangTimeSec: 1.2,
      landingPoint: { x: 5, y: 8 },
    });
    expect(resolveFoulBall(ball, defense)).toBeNull();
  });

  it('returns null for a pop-up beyond every fielder’s reach (>35ft cap)', () => {
    // Pop-up landing 80ft into the LF foul stands — out of reach
    const ball = makeBall({
      launchAngleDeg: 60,
      hangTimeSec: 3.5,
      landingPoint: { x: -200, y: 0 },
    });
    expect(resolveFoulBall(ball, defense)).toBeNull();
  });

  it('returns null when hang time is too short for any reach', () => {
    // Pop-up lands close to B3 but with almost no hang time
    const b3 = FIELDER_POSITIONS_FT.B3;
    const ball = makeBall({
      launchAngleDeg: 60,
      hangTimeSec: 0.2,
      landingPoint: { x: b3.x - 5, y: b3.y },
    });
    expect(resolveFoulBall(ball, defense)).toBeNull();
  });

  it('does not credit middle infielders or pitcher with foul catches', () => {
    // Pop-up landing right at SS — but SS shouldn't chase fouls
    const ss = FIELDER_POSITIONS_FT.SS;
    const ball = makeBall({
      launchAngleDeg: 60,
      hangTimeSec: 5.0,
      landingPoint: { x: ss.x, y: ss.y },
    });
    const caught = resolveFoulBall(ball, defense);
    // If caught at all, it must NOT be SS / B2 / CF / P
    if (caught) {
      expect(['SS', 'B2', 'CF', 'P']).not.toContain(caught.position);
    }
  });
});
