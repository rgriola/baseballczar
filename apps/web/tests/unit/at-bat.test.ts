import { describe, it, expect, vi, afterEach } from 'vitest';
import { resolveAtBat } from '@/lib/sim-engine/AtBat';
import { AtBatOutcome } from '@/lib/sim-engine/types';
import type { SkillThresholds } from '@/lib/sim-engine/types';

// Thresholds with clear ranges:
// S=0.2, D=0.3, T=0.35, HR=0.45, BB=0.6, K=0.8
const thresholds: SkillThresholds = {
  S: 0.2, D: 0.3, T: 0.35, HR: 0.45, BB: 0.6, K: 0.8, TOT: 15,
};

describe('resolveAtBat', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns Single when roll <= S', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.15);
    const { outcome } = resolveAtBat(thresholds, thresholds);
    expect(outcome).toBe(AtBatOutcome.Single);
  });

  it('returns Double when S < roll <= D', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.25);
    const { outcome } = resolveAtBat(thresholds, thresholds);
    expect(outcome).toBe(AtBatOutcome.Double);
  });

  it('returns Triple when D < roll <= T', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.32);
    const { outcome } = resolveAtBat(thresholds, thresholds);
    expect(outcome).toBe(AtBatOutcome.Triple);
  });

  it('returns HomeRun when T < roll <= HR', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.4);
    const { outcome } = resolveAtBat(thresholds, thresholds);
    expect(outcome).toBe(AtBatOutcome.HomeRun);
  });

  it('returns Walk when HR < roll <= BB', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.55);
    const { outcome } = resolveAtBat(thresholds, thresholds);
    expect(outcome).toBe(AtBatOutcome.Walk);
  });

  it('returns Strikeout when BB < roll <= K', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.75);
    const { outcome } = resolveAtBat(thresholds, thresholds);
    expect(outcome).toBe(AtBatOutcome.Strikeout);
  });

  it('returns GroundOut when roll > K', () => {
    vi.spyOn(Math, 'random').mockReturnValue(0.95);
    const { outcome } = resolveAtBat(thresholds, thresholds);
    expect(outcome).toBe(AtBatOutcome.GroundOut);
  });

  it('uses hitter thresholds when hitter dominates', () => {
    const hitter: SkillThresholds = { ...thresholds, TOT: 20 };
    const pitcher: SkillThresholds = { S: 0.05, D: 0.1, T: 0.12, HR: 0.15, BB: 0.2, K: 0.4, TOT: 10 };
    // roll=0.15 → with hitter thresholds (S=0.2), that's a single
    // but with pitcher thresholds (S=0.05), that would be past S into HR territory
    vi.spyOn(Math, 'random').mockReturnValue(0.15);
    const { outcome } = resolveAtBat(hitter, pitcher);
    expect(outcome).toBe(AtBatOutcome.Single); // hitter thresholds used
  });

  it('uses pitcher thresholds when pitcher dominates', () => {
    const hitter: SkillThresholds = { ...thresholds, TOT: 10 };
    const pitcher: SkillThresholds = { S: 0.05, D: 0.1, T: 0.12, HR: 0.15, BB: 0.2, K: 0.4, TOT: 20 };
    vi.spyOn(Math, 'random').mockReturnValue(0.15);
    const { outcome } = resolveAtBat(hitter, pitcher);
    expect(outcome).toBe(AtBatOutcome.HomeRun); // pitcher thresholds: 0.15 > T=0.12, <= HR=0.15
  });
});
