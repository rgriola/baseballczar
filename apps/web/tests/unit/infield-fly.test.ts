import { describe, it, expect } from 'vitest';
import { isInfieldFly, INFIELD_FLY, type BattedBall } from '@baseballczar/sim-engine';

const popUp: BattedBall = {
  exitVeloMph: 70,
  launchAngleDeg: 65,
  sprayAngleDeg: 5,
  distanceFt: 120,
  hangTimeSec: 4.2,
  landingPoint: { x: 10, y: 119 },
  isFoul: false,
  isHomeRun: false,
};

const runner = { id: 1 } as const;

describe('Infield Fly Rule', () => {
  it('fires with runners on 1st and 2nd, < 2 outs, qualifying pop-up', () => {
    expect(isInfieldFly({
      outs: 0,
      bases: [runner, runner, null],
      battedBall: popUp,
    })).toBe(true);
  });

  it('fires with bases loaded, 1 out', () => {
    expect(isInfieldFly({
      outs: 1,
      bases: [runner, runner, runner],
      battedBall: popUp,
    })).toBe(true);
  });

  it('does NOT fire with 2 outs', () => {
    expect(isInfieldFly({
      outs: 2,
      bases: [runner, runner, null],
      battedBall: popUp,
    })).toBe(false);
  });

  it('does NOT fire with only a runner on 1st (no force at 3B)', () => {
    expect(isInfieldFly({
      outs: 0,
      bases: [runner, null, null],
      battedBall: popUp,
    })).toBe(false);
  });

  it('does NOT fire with only runners on 1st and 3rd (no R2 — no force at 3B)', () => {
    expect(isInfieldFly({
      outs: 0,
      bases: [runner, null, runner],
      battedBall: popUp,
    })).toBe(false);
  });

  it('does NOT fire on a foul pop-up', () => {
    expect(isInfieldFly({
      outs: 0,
      bases: [runner, runner, null],
      battedBall: { ...popUp, isFoul: true },
    })).toBe(false);
  });

  it('does NOT fire on a low launch angle', () => {
    expect(isInfieldFly({
      outs: 0,
      bases: [runner, runner, null],
      battedBall: { ...popUp, launchAngleDeg: INFIELD_FLY.minLaunchAngleDeg - 1 },
    })).toBe(false);
  });

  it('does NOT fire on a deep fly (past the cut)', () => {
    expect(isInfieldFly({
      outs: 0,
      bases: [runner, runner, null],
      battedBall: { ...popUp, distanceFt: INFIELD_FLY.maxDistanceFt + 1 },
    })).toBe(false);
  });

  it('does NOT fire on a home run', () => {
    expect(isInfieldFly({
      outs: 0,
      bases: [runner, runner, null],
      battedBall: { ...popUp, isHomeRun: true },
    })).toBe(false);
  });

  it('does NOT fire when there is no batted ball (walk, K)', () => {
    expect(isInfieldFly({
      outs: 0,
      bases: [runner, runner, null],
      battedBall: undefined,
    })).toBe(false);
  });
});
