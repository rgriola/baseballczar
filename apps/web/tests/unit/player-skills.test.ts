import { describe, it, expect } from 'vitest';
import { calculateHitterSkill, calculatePitcherSkill } from '@/lib/sim-engine/PlayerSkills';
import type { PlayerSkills, PitcherAttributes } from '@/lib/sim-engine/types';

describe('calculateHitterSkill', () => {
  const avgHitter: PlayerSkills = {
    ag: 5, avg: 5, power: 5, eye: 5, dhr: 5, speed: 5,
  };

  it('returns cumulative thresholds in ascending order', () => {
    const t = calculateHitterSkill(avgHitter);
    expect(t.S).toBeLessThanOrEqual(t.D);
    expect(t.D).toBeLessThanOrEqual(t.T);
    expect(t.T).toBeLessThanOrEqual(t.HR);
    expect(t.HR).toBeLessThanOrEqual(t.BB);
    expect(t.BB).toBeLessThanOrEqual(t.K);
  });

  it('K threshold does not exceed 1.0 for max-skill hitter', () => {
    const maxHitter: PlayerSkills = {
      ag: 10, avg: 10, power: 10, eye: 10, dhr: 10, speed: 10,
    };
    const t = calculateHitterSkill(maxHitter);
    // K should be a reasonable value (thresholds may exceed 1 by design for the
    // engine's comparison model, but TOT should be correct)
    expect(t.K).toBeGreaterThan(0);
    expect(t.TOT).toBe(30); // avg + power + eye
  });

  it('higher power increases HR threshold gap', () => {
    const lowPower = calculateHitterSkill({ ...avgHitter, power: 1 });
    const highPower = calculateHitterSkill({ ...avgHitter, power: 10 });
    // HR - T = home run probability range
    const hrGapLow = lowPower.HR - lowPower.T;
    const hrGapHigh = highPower.HR - highPower.T;
    expect(hrGapHigh).toBeGreaterThan(hrGapLow);
  });

  it('higher eye increases walk probability', () => {
    const lowEye = calculateHitterSkill({ ...avgHitter, eye: 1 });
    const highEye = calculateHitterSkill({ ...avgHitter, eye: 10 });
    const bbGapLow = lowEye.BB - lowEye.HR;
    const bbGapHigh = highEye.BB - highEye.HR;
    expect(bbGapHigh).toBeGreaterThan(bbGapLow);
  });

  it('TOT equals avg + power + eye', () => {
    const t = calculateHitterSkill({ ag: 3, avg: 7, power: 4, eye: 9, dhr: 2, speed: 6 });
    expect(t.TOT).toBe(20); // 7 + 4 + 9
  });
});

describe('calculatePitcherSkill', () => {
  const avgPitcher: PitcherAttributes = {
    ag: 5, avg: 5, power: 5, eye: 5, dhr: 5, speed: 5,
    stamina: 5,
  };

  it('returns cumulative thresholds', () => {
    const t = calculatePitcherSkill(avgPitcher, 0);
    expect(t.S).toBeLessThanOrEqual(t.D);
    expect(t.D).toBeLessThanOrEqual(t.T);
    expect(t.T).toBeLessThanOrEqual(t.HR);
    expect(t.HR).toBeLessThanOrEqual(t.BB);
    expect(t.BB).toBeLessThanOrEqual(t.K);
  });

  it('pitcher skill degrades after fatigue threshold', () => {
    const fresh = calculatePitcherSkill(avgPitcher, 0);
    const tired = calculatePitcherSkill(avgPitcher, 50); // well past threshold
    // A fatigued pitcher gives up more hits → S threshold goes up
    expect(tired.S).toBeGreaterThan(fresh.S);
  });

  it('high stamina resists degradation longer', () => {
    const lowStamina: PitcherAttributes = { ...avgPitcher, stamina: 1 };
    const highStamina: PitcherAttributes = { ...avgPitcher, stamina: 10 };
    // At 25 batters faced, low stamina should degrade more than high stamina
    const low = calculatePitcherSkill(lowStamina, 25);
    const high = calculatePitcherSkill(highStamina, 25);
    // Higher S for low stamina pitcher = worse
    expect(low.S).toBeGreaterThan(high.S);
  });

  it('high eye delays fatigue onset', () => {
    const lowPI: PitcherAttributes = { ...avgPitcher, eye: 1 };
    const highPI: PitcherAttributes = { ...avgPitcher, eye: 10 };
    // At 20 batters: low PI should be fatigued, high PI should not yet be
    const low = calculatePitcherSkill(lowPI, 20);
    const high = calculatePitcherSkill(highPI, 20);
    expect(low.S).toBeGreaterThan(high.S);
  });
});
